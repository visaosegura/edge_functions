import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const ASAAS_SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const ASAAS_PRODUCTION_URL = "https://api.asaas.com/v3";
/**
 * Edge Function: asaas-manage-webhook
 * 
 * Gerencia webhooks no Asaas (criar, listar, atualizar, deletar).
 * Uso exclusivo do administrador.
 * 
 * Secrets necessárias:
 * - ASAAS_API_KEY: Chave de API do Asaas
 * - ASAAS_ENVIRONMENT: "sandbox" ou "production" (default: sandbox)
 */ Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
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
  try {
    // Verificar autenticação do usuário (apenas admin)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Não autorizado"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Verificar se o usuário é admin
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: "Token inválido"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: dadosUsuario } = await supabase.from("dados_usuario").select("tipo_cliente").eq("auth_user_id", user.id).single();
    if (!dadosUsuario || dadosUsuario.tipo_cliente !== "admin") {
      return new Response(JSON.stringify({
        error: "Acesso restrito a administradores"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Configurações do Asaas
    const asaasApiKey = Deno.env.get("ASAAS_API_KEY") ?? "";
    const asaasEnv = Deno.env.get("ASAAS_ENVIRONMENT") ?? "sandbox";
    const baseUrl = asaasEnv === "production" ? ASAAS_PRODUCTION_URL : ASAAS_SANDBOX_URL;
    if (!asaasApiKey) {
      return new Response(JSON.stringify({
        error: "ASAAS_API_KEY não configurada"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { action, webhookId, url, email, enabled, events, authToken } = await req.json();
    let result;
    switch(action){
      case "register":
        result = await registerWebhook(baseUrl, asaasApiKey, {
          url,
          email,
          enabled,
          events,
          authToken
        });
        break;
      case "list":
        result = await listWebhooks(baseUrl, asaasApiKey);
        break;
      case "update":
        if (!webhookId) throw new Error("webhookId é obrigatório para atualizar");
        result = await updateWebhook(baseUrl, asaasApiKey, webhookId, {
          url,
          email,
          enabled,
          events,
          authToken
        });
        break;
      case "delete":
        if (!webhookId) throw new Error("webhookId é obrigatório para deletar");
        result = await deleteWebhook(baseUrl, asaasApiKey, webhookId);
        break;
      default:
        throw new Error(`Ação desconhecida: ${action}`);
    }
    return new Response(JSON.stringify({
      success: true,
      ...result
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ [asaas-manage-webhook] Erro:", error.message);
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
// REGISTRAR WEBHOOK
// =============================================
async function registerWebhook(baseUrl, apiKey, config) {
  if (!config.url) throw new Error("URL do webhook é obrigatória");
  // Eventos padrão se não informados
  const defaultEvents = [
    // Pagamentos
    "PAYMENT_CREATED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE",
    "PAYMENT_DELETED",
    "PAYMENT_REFUNDED",
    "PAYMENT_UPDATED",
    "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    // Assinaturas
    "SUBSCRIPTION_CREATED",
    "SUBSCRIPTION_UPDATED",
    "SUBSCRIPTION_INACTIVATED",
    "SUBSCRIPTION_DELETED"
  ];
  const body = {
    name: "Visão Segura - Webhook",
    url: config.url,
    email: config.email || "",
    enabled: config.enabled !== false,
    interrupted: false,
    apiVersion: 3,
    authToken: config.authToken || "",
    sendType: "SEQUENTIALLY",
    events: config.events || defaultEvents
  };
  const response = await fetch(`${baseUrl}/webhooks`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: apiKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(()=>({}));
    throw new Error(`Erro ao registrar webhook: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  const data = await response.json();
  console.log(`✅ Webhook registrado: ${data.id}`);
  return {
    webhook: data
  };
}
// =============================================
// LISTAR WEBHOOKS
// =============================================
async function listWebhooks(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl}/webhooks`, {
    method: "GET",
    headers: {
      accept: "application/json",
      access_token: apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Erro ao listar webhooks: ${response.statusText}`);
  }
  const data = await response.json();
  return {
    webhooks: data.data || data
  };
}
// =============================================
// ATUALIZAR WEBHOOK
// =============================================
async function updateWebhook(baseUrl, apiKey, webhookId, config) {
  const body = {};
  if (config.url !== undefined) body.url = config.url;
  if (config.email !== undefined) body.email = config.email;
  if (config.enabled !== undefined) body.enabled = config.enabled;
  if (config.events !== undefined) body.events = config.events;
  if (config.authToken !== undefined) body.authToken = config.authToken;
  const response = await fetch(`${baseUrl}/webhooks/${webhookId}`, {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: apiKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(()=>({}));
    throw new Error(`Erro ao atualizar webhook: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  const data = await response.json();
  console.log(`✅ Webhook atualizado: ${webhookId}`);
  return {
    webhook: data
  };
}
// =============================================
// DELETAR WEBHOOK
// =============================================
async function deleteWebhook(baseUrl, apiKey, webhookId) {
  const response = await fetch(`${baseUrl}/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: {
      accept: "application/json",
      access_token: apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Erro ao deletar webhook: ${response.statusText}`);
  }
  const data = await response.json();
  console.log(`✅ Webhook deletado: ${webhookId}`);
  return {
    deleted: true,
    data
  };
}
