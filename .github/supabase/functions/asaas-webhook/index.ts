import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, validateAsaasWebhook, checkRateLimit, maskSensitiveData, secureLog } from "./security.ts";
/**
 * Edge Function: asaas-webhook
 * 
 * Recebe eventos de webhook do Asaas e processa:
 * - Eventos de pagamento (PAYMENT_*)
 * - Eventos de assinatura (SUBSCRIPTION_*)
 * 
 * Segurança:
 * - Valida authToken enviado pelo Asaas no header
 * - Idempotência via event_id único na tabela asaas_webhooks
 * - Rate limiting por IP
 * - Logs seguros sem dados sensíveis
 * 
 * Secrets necessárias:
 * - ASAAS_WEBHOOK_TOKEN: Token de autenticação configurado no Asaas
 */ Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  // Apenas POST é aceito
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);
  try {
    // =============================================
    // 1. RATE LIMITING POR IP
    // =============================================
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(clientIp, 30, 60000)) {
      secureLog('⚠️ Rate limit excedido', {
        ip: clientIp
      });
      return new Response(JSON.stringify({
        error: "Too many requests"
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // =============================================
    // 2. VALIDAR WEBHOOK ASAAS (TOKEN)
    // =============================================
    if (!validateAsaasWebhook(req)) {
      secureLog('⚠️ Token de webhook inválido', {
        ip: clientIp
      });
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // =============================================
    // 3. PARSEAR PAYLOAD
    // =============================================
    const body = await req.json();
    const eventId = body.id;
    const eventType = body.event;
    if (!eventId || !eventType) {
      secureLog('❌ Payload inválido', {
        hasId: !!eventId,
        hasEvent: !!eventType
      });
      return new Response(JSON.stringify({
        error: "Invalid payload: missing id or event"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Log seguro (sem dados sensíveis)
    secureLog(`📨 Webhook recebido: ${eventType}`, {
      eventId,
      eventType,
      payload: maskSensitiveData(body)
    });
    // =============================================
    // 4. IDEMPOTÊNCIA - Verificar se evento já foi recebido
    // =============================================
    const { error: insertError } = await supabase.from("asaas_webhooks").insert({
      event_id: eventId,
      event_type: eventType,
      payload: body,
      status: "PENDING"
    });
    if (insertError) {
      // Unique violation = evento já recebido (idempotência)
      if (insertError.code === "23505") {
        secureLog(`ℹ️ Evento duplicado ignorado: ${eventId}`);
        return new Response(JSON.stringify({
          received: true,
          duplicate: true
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      throw insertError;
    }
    // =============================================
    // 5. PROCESSAR EVENTO
    // =============================================
    try {
      await processEvent(supabase, eventType, body);
      // Marcar como processado
      await supabase.from("asaas_webhooks").update({
        status: "DONE",
        processed_at: new Date().toISOString()
      }).eq("event_id", eventId);
      console.log(`✅ Evento processado: ${eventType} (${eventId})`);
    } catch (processError) {
      // Marcar como erro mas não rejeitar o webhook
      console.error(`❌ Erro ao processar evento ${eventId}:`, processError.message);
      await supabase.from("asaas_webhooks").update({
        status: "ERROR",
        error_message: processError.message,
        processed_at: new Date().toISOString()
      }).eq("event_id", eventId);
    }
    // Sempre retornar 200 após salvar o evento (mesmo se processamento falhar)
    // Isso evita que o Asaas reenvie o mesmo evento
    return new Response(JSON.stringify({
      received: true
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Erro crítico no webhook:", error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
// =============================================
// PROCESSADOR DE EVENTOS
// =============================================
async function processEvent(supabase, eventType, body) {
  // Eventos de PAGAMENTO
  if (eventType.startsWith("PAYMENT_")) {
    await processPaymentEvent(supabase, eventType, body.payment);
    return;
  }
  // Eventos de ASSINATURA
  if (eventType.startsWith("SUBSCRIPTION_")) {
    await processSubscriptionEvent(supabase, eventType, body.subscription);
    return;
  }
  console.log(`ℹ️ Evento não tratado: ${eventType}`);
}
// =============================================
// EVENTOS DE PAGAMENTO
// =============================================
async function processPaymentEvent(supabase, eventType, payment) {
  if (!payment) {
    console.warn("⚠️ Payload de pagamento vazio");
    return;
  }
  const asaasPaymentId = payment.id;
  const subscriptionId = payment.subscription; // ID da assinatura no Asaas
  // Mapear status do evento para status interno
  const statusMap = {
    PAYMENT_CREATED: "PENDING",
    PAYMENT_AWAITING_RISK_ANALYSIS: "PENDING",
    PAYMENT_APPROVED_BY_RISK_ANALYSIS: "PENDING",
    PAYMENT_REPROVED_BY_RISK_ANALYSIS: "REFUNDED",
    PAYMENT_UPDATED: payment.status || "PENDING",
    PAYMENT_CONFIRMED: "CONFIRMED",
    PAYMENT_RECEIVED: "RECEIVED",
    PAYMENT_ANTICIPATED: "RECEIVED",
    PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "REFUSED",
    PAYMENT_OVERDUE: "OVERDUE",
    PAYMENT_DELETED: "DELETED",
    PAYMENT_RESTORED: "PENDING",
    PAYMENT_REFUNDED: "REFUNDED",
    PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
    PAYMENT_RECEIVED_IN_CASH_UNDONE: "PENDING",
    PAYMENT_CHARGEBACK_REQUESTED: "CHARGEBACK",
    PAYMENT_CHARGEBACK_DISPUTE: "CHARGEBACK",
    PAYMENT_AWAITING_CHARGEBACK_REVERSAL: "CHARGEBACK",
    PAYMENT_DUNNING_RECEIVED: "RECEIVED",
    PAYMENT_DUNNING_REQUESTED: "OVERDUE"
  };
  const newStatus = statusMap[eventType] || payment.status || "PENDING";
  // Buscar a assinatura local pelo asaas_subscription_id
  let localSubscriptionId = null;
  if (subscriptionId) {
    const { data: assinatura } = await supabase.from("assinaturas").select("id").eq("asaas_subscription_id", subscriptionId).single();
    if (assinatura) {
      localSubscriptionId = assinatura.id;
    }
  }
  // Dados da cobrança para upsert
  const cobrancaData = {
    asaas_payment_id: asaasPaymentId,
    billing_type: payment.billingType || null,
    value: payment.value || 0,
    net_value: payment.netValue || null,
    due_date: payment.dueDate || null,
    payment_date: payment.paymentDate || null,
    status: newStatus,
    invoice_url: payment.invoiceUrl || null,
    bank_slip_url: payment.bankSlipUrl || null,
    description: payment.description || null,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString()
  };
  // Adicionar dados PIX se disponíveis
  if (payment.pix) {
    cobrancaData.pix_qrcode = payment.pix.encodedImage || null;
    cobrancaData.pix_copy_paste = payment.pix.payload || null;
  }
  if (localSubscriptionId) {
    cobrancaData.id_assinatura = localSubscriptionId;
  }
  // Upsert na tabela cobrancas (atualiza se já existe)
  const { error: upsertError } = await supabase.from("cobrancas").upsert(cobrancaData, {
    onConflict: "asaas_payment_id"
  });
  if (upsertError) {
    console.error("❌ Erro ao salvar cobrança:", upsertError.message);
    throw upsertError;
  }
  console.log(`💰 Cobrança ${asaasPaymentId} atualizada: ${newStatus}`);
  // Se pagamento foi confirmado/recebido, atualizar status da assinatura para ACTIVE
  if (localSubscriptionId && (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED")) {
    await supabase.from("assinaturas").update({
      status: "ACTIVE",
      updated_at: new Date().toISOString()
    }).eq("id", localSubscriptionId).in("status", [
      "PENDING",
      "OVERDUE"
    ]); // Só atualiza se estava pendente/atrasada
    console.log(`✅ Assinatura ${localSubscriptionId} ativada via pagamento`);
  }
  // Se pagamento está atrasado, atualizar status da assinatura
  if (localSubscriptionId && eventType === "PAYMENT_OVERDUE") {
    await supabase.from("assinaturas").update({
      status: "OVERDUE",
      updated_at: new Date().toISOString()
    }).eq("id", localSubscriptionId);
    console.log(`⚠️ Assinatura ${localSubscriptionId} marcada como OVERDUE`);
  }
}
// =============================================
// EVENTOS DE ASSINATURA
// =============================================
async function processSubscriptionEvent(supabase, eventType, subscription) {
  if (!subscription) {
    console.warn("⚠️ Payload de assinatura vazio");
    return;
  }
  const asaasSubscriptionId = subscription.id;
  // Mapear status do evento
  const statusMap = {
    SUBSCRIPTION_CREATED: "ACTIVE",
    SUBSCRIPTION_UPDATED: subscription.status || "ACTIVE",
    SUBSCRIPTION_INACTIVATED: "INACTIVE",
    SUBSCRIPTION_DELETED: "CANCELLED",
    SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK: "SUSPENDED",
    SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED: "ACTIVE"
  };
  const newStatus = statusMap[eventType] || "ACTIVE";
  // Atualizar assinatura local
  const updateData = {
    status: newStatus,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString()
  };
  // Se foi cancelada/inativada, registrar data
  if (eventType === "SUBSCRIPTION_DELETED" || eventType === "SUBSCRIPTION_INACTIVATED") {
    updateData.cancelled_at = new Date().toISOString();
  }
  // Se tem próxima data de vencimento, atualizar
  if (subscription.nextDueDate) {
    updateData.next_due_date = subscription.nextDueDate;
  }
  // Se tem valor atualizado
  if (subscription.value) {
    updateData.value = subscription.value;
  }
  const { error } = await supabase.from("assinaturas").update(updateData).eq("asaas_subscription_id", asaasSubscriptionId);
  if (error) {
    console.error("❌ Erro ao atualizar assinatura:", error.message);
    throw error;
  }
  console.log(`📋 Assinatura ${asaasSubscriptionId} atualizada: ${newStatus} (${eventType})`);
}
