import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, ASAAS_API_URL, validateAuth, validateAssinaturaAccess, secureLog, errorResponse } from './security.ts';
serve(async (req)=>{
  const requestId = crypto.randomUUID();
  secureLog('🔷 Iniciando requisição list-payments', {
    requestId,
    method: req.method
  });
  if (req.method === 'OPTIONS') {
    secureLog('✅ CORS Preflight', {
      requestId
    });
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  if (req.method !== 'POST') {
    secureLog('❌ Método não permitido', {
      requestId,
      method: req.method
    });
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    secureLog('🔧 Criando cliente Supabase', {
      requestId
    });
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    secureLog('🔐 Validando autenticação', {
      requestId
    });
    const user = await validateAuth(req, supabaseClient);
    secureLog('✅ Autenticação validada', {
      requestId,
      userId: user.id
    });
    secureLog('📥 Parseando payload', {
      requestId
    });
    const payload = await req.json();
    const { assinaturaId, status } = payload;
    secureLog('📋 Payload recebido', {
      requestId,
      assinaturaId,
      status
    });
    // Validação de input
    secureLog('🔍 Validando assinaturaId', {
      requestId
    });
    if (!assinaturaId || typeof assinaturaId !== 'string') {
      secureLog('❌ assinaturaId inválido', {
        requestId,
        assinaturaId
      });
      throw new Error('assinaturaId inválido');
    }
    secureLog('✅ assinaturaId válido', {
      requestId
    });
    // Validar autorização
    secureLog('🛡️ Validando acesso à assinatura', {
      requestId,
      userId: user.id,
      assinaturaId
    });
    const hasAccess = await validateAssinaturaAccess(supabaseClient, user.id, assinaturaId);
    if (!hasAccess) {
      secureLog(`⛔ Acesso não autorizado: User ${user.id} -> Assinatura ${assinaturaId}`, {
        requestId
      });
      throw new Error('Acesso negado');
    }
    secureLog('✅ Acesso autorizado', {
      requestId
    });
    // Buscar assinatura
    secureLog('🔍 Buscando assinatura', {
      requestId,
      assinaturaId
    });
    const { data: subscription, error: subError } = await supabaseClient.from('assinaturas').select('*').eq('id_assinatura', assinaturaId).single();
    if (subError || !subscription) {
      secureLog('❌ Assinatura não encontrada', {
        requestId,
        assinaturaId,
        error: subError
      });
      throw new Error('Assinatura não encontrada');
    }
    secureLog('✅ Assinatura encontrada', {
      requestId
    });
    // Configuração Asaas
    secureLog('🔧 Configurando Asaas', {
      requestId
    });
    const asaasApiKey = Deno.env.get('ASAAS_API_KEY');
    if (!asaasApiKey) {
      secureLog('❌ API Key ausente', {
        requestId
      });
      throw new Error('Configuração de API Asaas ausente');
    }
    if (!subscription.asaas_subscription_id) {
      secureLog('❌ ID Asaas ausente', {
        requestId
      });
      throw new Error('ID de assinatura no Asaas não encontrado');
    }
    secureLog('✅ Asaas configurado', {
      requestId,
      url: ASAAS_API_URL
    });
    // Buscar cobranças no Asaas
    const url = `${ASAAS_API_URL}/subscriptions/${subscription.asaas_subscription_id}/payments${status ? `?status=${status}` : ''}`;
    secureLog('🔍 Buscando cobranças no Asaas', {
      requestId,
      assinaturaId,
      asaasSubscriptionId: subscription.asaas_subscription_id,
      status
    });
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'access_token': asaasApiKey
      }
    });
    secureLog('📡 Resposta Asaas', {
      requestId,
      status: response.status,
      ok: response.ok
    });
    if (!response.ok) {
      const error = await response.json();
      secureLog('❌ Erro ao buscar cobranças', {
        requestId,
        status: response.status,
        error
      });
      throw new Error('Erro ao buscar cobranças no gateway');
    }
    const payments = await response.json();
    const paymentCount = payments.data?.length || 0;
    secureLog('✅ Cobranças obtidas do Asaas', {
      requestId,
      count: paymentCount
    });
    // Sincronizar cobranças
    secureLog('💾 Sincronizando cobranças no banco', {
      requestId,
      count: paymentCount
    });
    for (const payment of payments.data || []){
      await supabaseClient.from('cobrancas').upsert({
        id_assinatura: assinaturaId,
        asaas_payment_id: payment.id,
        billing_type: payment.billingType,
        value: payment.value,
        net_value: payment.netValue,
        due_date: payment.dueDate,
        payment_date: payment.paymentDate,
        status: payment.status,
        invoice_url: payment.invoiceUrl,
        bank_slip_url: payment.bankSlipUrl,
        pix_qrcode: payment.pixQrCode,
        pix_copy_paste: payment.pixCopyAndPaste,
        description: payment.description,
        external_reference: payment.externalReference,
        synced_at: new Date().toISOString()
      }, {
        onConflict: 'asaas_payment_id'
      });
    }
    secureLog('✅ Cobranças sincronizadas', {
      requestId
    });
    // Buscar cobranças do banco
    secureLog('🔍 Buscando cobranças do banco', {
      requestId,
      assinaturaId
    });
    const { data: cobrancas } = await supabaseClient.from('cobrancas').select('*').eq('id_assinatura', assinaturaId).order('due_date', {
      ascending: false
    });
    secureLog('✅ Cobranças retornadas', {
      requestId,
      count: cobrancas?.length || 0
    });
    secureLog('🎉 Operação concluída', {
      requestId
    });
    return new Response(JSON.stringify({
      success: true,
      payments: cobrancas || []
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    secureLog('💥 Erro', {
      requestId,
      message: error.message,
      stack: error.stack
    });
    return errorResponse(error, error.message.includes('Acesso negado') ? 403 : 400);
  }
});
