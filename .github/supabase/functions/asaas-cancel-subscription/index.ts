import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, ASAAS_API_URL, validateAuth, validateAssinaturaAccess, secureLog, errorResponse } from './security.ts';
serve(async (req)=>{
  const requestId = crypto.randomUUID();
  secureLog('🔷 Iniciando requisição cancel-subscription', {
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
    const { assinaturaId } = payload;
    secureLog('📋 Payload recebido', {
      requestId,
      assinaturaId
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
      requestId,
      status: subscription.status
    });
    // Verificar se já está cancelada
    if (subscription.status === 'EXPIRED' && subscription.cancelled_at) {
      secureLog('ℹ️ Assinatura já estava cancelada', {
        requestId,
        cancelledAt: subscription.cancelled_at
      });
      return new Response(JSON.stringify({
        success: true,
        message: 'Assinatura já estava cancelada',
        subscription: {
          id: subscription.id_assinatura,
          status: subscription.status,
          cancelled_at: subscription.cancelled_at
        }
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
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
    secureLog('🗑️ Cancelando assinatura no Asaas', {
      requestId,
      assinaturaId,
      asaasSubscriptionId: subscription.asaas_subscription_id
    });
    const response = await fetch(`${ASAAS_API_URL}/subscriptions/${subscription.asaas_subscription_id}`, {
      method: 'DELETE',
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
      secureLog('⚠️ Erro ao cancelar no Asaas', {
        requestId,
        status: response.status,
        error
      });
      if (response.status === 404) {
        secureLog('ℹ️ Assinatura já deletada no Asaas', {
          requestId
        });
      } else {
        throw new Error('Erro ao cancelar assinatura no gateway');
      }
    } else {
      secureLog('✅ Assinatura cancelada no Asaas', {
        requestId
      });
    }
    // Atualizar localmente
    secureLog('💾 Atualizando status local', {
      requestId
    });
    const { data: updatedSubscription, error: updateError } = await supabaseClient.from('assinaturas').update({
      status: 'EXPIRED',
      cancelled_at: new Date().toISOString()
    }).eq('id_assinatura', assinaturaId).select().single();
    if (updateError) {
      secureLog('❌ Erro ao atualizar status', {
        requestId,
        error: updateError
      });
      throw new Error('Erro ao atualizar status da assinatura');
    }
    secureLog('✅ Status local atualizado', {
      requestId
    });
    // Remover plano do cliente
    secureLog('💾 Removendo plano do cliente', {
      requestId,
      clienteId: subscription.id_cliente
    });
    await supabaseClient.from('cliente').update({
      id_plano: null
    }).eq('id_cliente', subscription.id_cliente);
    secureLog('✅ Plano do cliente removido', {
      requestId
    });
    secureLog('🎉 Assinatura cancelada com sucesso', {
      requestId,
      assinaturaId
    });
    return new Response(JSON.stringify({
      success: true,
      message: 'Assinatura cancelada com sucesso',
      subscription: {
        id: updatedSubscription.id_assinatura,
        status: updatedSubscription.status,
        cancelled_at: updatedSubscription.cancelled_at
      }
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
