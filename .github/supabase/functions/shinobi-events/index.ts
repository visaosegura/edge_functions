import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const url = new URL(req.url);
    const eventType = url.searchParams.get("type");
    const eventDataRaw = url.searchParams.get("data");
    console.log(`🔔 Webhook Recebido. Tipo: ${eventType}`);
    if (!eventType || !eventDataRaw) {
      return new Response(JSON.stringify({
        error: "Parâmetros 'type' ou 'data' ausentes na URL"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // 1. Parsear o JSON do Shinobi
    let parsedData = {};
    let monitorId = "";
    let finalDetails = {};
    try {
      parsedData = JSON.parse(eventDataRaw);
      // Estratégia de busca do Monitor ID (baseada no seu log)
      // O log mostra: data = { "info": { "mid": "...", "eventDetails": ... } }
      if (parsedData.info && parsedData.info.mid) {
        monitorId = parsedData.info.mid;
        finalDetails = parsedData.info.eventDetails || parsedData.info;
      } else if (parsedData.mid) {
        monitorId = parsedData.mid;
        finalDetails = parsedData;
      } else {
        monitorId = "unknown";
        finalDetails = parsedData;
        console.warn("⚠️ Monitor ID não encontrado na estrutura do JSON:", JSON.stringify(parsedData));
      }
    } catch (e) {
      console.error("❌ Erro ao ler JSON do Shinobi:", e);
      return new Response(JSON.stringify({
        error: "JSON inválido no parâmetro 'data'"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // 2. Conectar ao Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    // 3. Salvar na Tabela camera_events
    console.log(`💾 Salvando evento para Monitor: ${monitorId}`);
    const { error } = await supabase.from('camera_events').insert({
      monitor_id: monitorId,
      event_type: eventType,
      details: finalDetails
    });
    if (error) {
      console.error("❌ Erro ao salvar no banco:", error.message);
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    return new Response(JSON.stringify({
      success: true,
      id: monitorId
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Erro Crítico:", error.message);
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
