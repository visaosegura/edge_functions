import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// VALORES PADRÃO (Para quando o banco falhar)
const DEFAULT_HOST = "https://cloud.visaosegura.seg.br";
const DEFAULT_API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM"; // Verifique se o 'I' está correto
const DEFAULT_GROUP_KEY = "aMOFHzf8Fk";
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const { cameraId } = await req.json();
    if (!cameraId) throw new Error("Camera ID is required");
    // 1. Conectar no Banco
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    // 2. Buscar dados
    const { data: camera, error } = await supabase.from("cameras").select("shinobi_monitor_id, shinobi_group_key, shinobi_host").eq("id", cameraId).single();
    if (error || !camera) throw new Error("Câmera não encontrada no banco");
    // 3. Preparar Variáveis
    const host = camera.shinobi_host || DEFAULT_HOST;
    const apiKey = DEFAULT_API_KEY;
    const groupKey = camera.shinobi_group_key || DEFAULT_GROUP_KEY;
    const monitorId = camera.shinobi_monitor_id;
    if (!monitorId) throw new Error("ID do Monitor Shinobi está vazio no Banco de Dados.");
    // 4. Montar a URL
    const liveStreamUrl = `${host}/${apiKey}/hls/${groupKey}/${monitorId}/s.m3u8`;
    // =================================================================
    // 🕵️ DEBUGGING ATIVO: Testar se a URL funciona antes de retornar
    // =================================================================
    console.log(`🔍 Testando conexão com: ${liveStreamUrl}`);
    try {
      // Fazemos uma requisição ao Shinobi para ver se ele aceita
      const testResponse = await fetch(liveStreamUrl, {
        method: "GET"
      });
      if (!testResponse.ok) {
        // SE DER ERRO, CAPTURAMOS A MENSAGEM DO SHINOBI
        const errorBody = await testResponse.text(); // Pode ser JSON ou Texto
        console.error("❌ Shinobi Recusou:", testResponse.status, errorBody);
        return new Response(JSON.stringify({
          success: false,
          error_type: "SHINOBI_REJECTED",
          status_code: testResponse.status,
          shinobi_message: errorBody,
          url_attempted: liveStreamUrl
        }), {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      console.log("✅ Conexão Shinobi: SUCESSO!");
    } catch (networkError) {
      console.error("❌ Erro de Rede (Timeout/IP):", networkError.message);
      return new Response(JSON.stringify({
        success: false,
        error_type: "NETWORK_ERROR",
        message: "Não foi possível conectar ao servidor Shinobi. Verifique se o IP está acessível.",
        details: networkError.message
      }), {
        status: 504,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 5. Se passou no teste, retorna as URLs
    const recordingsListUrl = `${host}/${apiKey}/videos/${groupKey}/${monitorId}`;
    const hostOnly = host.replace(':8080', '');
    const recordingBaseUrl = `${hostOnly}/videos/${groupKey}/${monitorId}`;
    return new Response(JSON.stringify({
      success: true,
      urls: {
        live: liveStreamUrl,
        recordings_api: recordingsListUrl,
        recordings_base: recordingBaseUrl
      },
      meta: {
        monitor_id: monitorId
      }
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
