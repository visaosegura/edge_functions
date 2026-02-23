import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders,
  ASAAS_API_URL,
  validateAuth,
  validateAssinaturaAccess,
  secureLog,
  errorResponse
} from './security.ts'  

serve(async (req) => {
  const requestId = crypto.randomUUID()
  
  secureLog('🔷 Iniciando requisição list-payments', { requestId, method: req.method })

  if (req.method === 'OPTIONS') {
    secureLog('✅ CORS Preflight', { requestId })
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    secureLog('❌ Método não permitido', { requestId, method: req.method })
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    secureLog('🔧 Criando cliente Supabase', { requestId })
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    secureLog('🔐 Validando autenticação', { requestId })
    const user = await validateAuth(req, supabaseClient)
    secureLog('✅ Autenticação validada', { requestId, userId: user.id })
    
    secureLog('📥 Parseando payload', { requestId })
    const payload = await req.json()
    const { assinaturaId, status } = payload
    
    secureLog('📋 Payload recebido', { requestId, assinaturaId, status })
    
    // 1. Validação de input (ID como String para evitar erro de tipo)
    const idParaValidar = assinaturaId?.toString();
    if (!idParaValidar) {
      secureLog('❌ assinaturaId ausente', { requestId, payload });
      throw new Error('assinaturaId inválido');
    }
    
    // 2. Validar autorização (Agora usando o security.ts atualizado)
    secureLog('🛡️ Validando acesso à assinatura', { requestId, userId: user.id, assinaturaId: idParaValidar })
    const hasAccess = await validateAssinaturaAccess(supabaseClient, user.id, idParaValidar)
    if (!hasAccess) {
      secureLog(`⛔ Acesso não autorizado: User ${user.id} -> Assinatura ${idParaValidar}`, { requestId })
      throw new Error('Acesso negado')
    }
    secureLog('✅ Acesso autorizado', { requestId })
    
    // 3. Buscar assinatura no banco (Certificando que buscamos pela coluna 'id')
    secureLog('🔍 Buscando assinatura', { requestId, idParaValidar })
    const { data: subscription, error: subError } = await supabaseClient
      .from('assinaturas')
      .select('*')
      .eq('id', idParaValidar)
      .single()
    
    if (subError || !subscription) {
      secureLog('❌ Assinatura não encontrada no banco', { requestId, idParaValidar, error: subError })
      throw new Error('Assinatura não encontrada')
    }
    
    // 4. Configuração Asaas
    const asaasApiKey = Deno.env.get('ASAAS_API_KEY')
    if (!asaasApiKey) throw new Error('Configuração de API Asaas ausente')
    
    if (!subscription.asaas_subscription_id) {
      secureLog('❌ ID Asaas ausente na tabela', { requestId })
      throw new Error('Esta assinatura não possui um ID vinculado no Asaas')
    }
    
    // 5. Buscar cobranças no Asaas
    const queryParams = status ? `?status=${status}` : ''
    const url = `${ASAAS_API_URL}/subscriptions/${subscription.asaas_subscription_id}/payments${queryParams}`
    
    secureLog('🔍 Chamando API Asaas', { url })
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'access_token': asaasApiKey
      }
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      secureLog('❌ Erro API Asaas', { requestId, status: response.status, errorData })
      throw new Error('Erro ao buscar cobranças no gateway Asaas')
    }
    
    const payments = await response.json()
    secureLog('✅ Dados recebidos do Asaas', { count: payments.data?.length || 0 })
    
    // 6. Sincronizar cobranças (Upsert)
    // OBS: Aqui usamos 'id_assinatura' pois é a coluna na tabela de cobrancas
    for (const payment of payments.data || []) {
      const { error: upsertError } = await supabaseClient
        .from('cobrancas')
        .upsert({
          id_assinatura: idParaValidar,
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
        })
      
      if (upsertError) {
        secureLog('⚠️ Erro no upsert da cobrança', { paymentId: payment.id, error: upsertError })
      }
    }
    
    // 7. Retornar dados atualizados do banco
    const { data: cobrancas } = await supabaseClient
      .from('cobrancas')
      .select('*')
      .eq('id_assinatura', idParaValidar)
      .order('due_date', { ascending: false })
    
    secureLog('🎉 Operação concluída com sucesso', { requestId })
    
    return new Response(JSON.stringify({
      success: true,
      payments: cobrancas || []
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    
  } catch (error) {
    secureLog('💥 Erro fatal na Edge Function', { requestId, message: error.message })
    return errorResponse(error, error.message.includes('Acesso negado') ? 403 : 400)
  }
})