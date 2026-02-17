import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { KinesisVideoClient, GetDataEndpointCommand } from "npm:@aws-sdk/client-kinesis-video";
import { KinesisVideoArchivedMediaClient, GetHLSStreamingSessionURLCommand } from "npm:@aws-sdk/client-kinesis-video-archived-media";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // ⚠️ STREAM FIXO PARA TESTE
    const streamName = "teste-manual";
    console.log(`🎥 Gerando URL HLS para stream: ${streamName}`);
    const region = Deno.env.get("AWS_REGION") ?? "us-east-2";
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Credenciais AWS não configuradas na Edge Function");
    }
    const credentials = {
      accessKeyId,
      secretAccessKey
    };
    // 1 - Get endpoint HLS
    console.log("📡 Buscando Data Endpoint...");
    const kv = new KinesisVideoClient({
      region,
      credentials
    });
    const dataEndpointResp = await kv.send(new GetDataEndpointCommand({
      APIName: "GET_HLS_STREAMING_SESSION_URL",
      StreamName: streamName
    }));
    const endpoint = dataEndpointResp.DataEndpoint;
    console.log(`✅ Endpoint: ${endpoint}`);
    // 2 - Client Archived Media
    const kvMedia = new KinesisVideoArchivedMediaClient({
      region,
      endpoint,
      credentials
    });
    // 3 - Gera URL HLS em modo LIVE
    console.log("🎬 Gerando URL HLS...");
    const hlsResp = await kvMedia.send(new GetHLSStreamingSessionURLCommand({
      StreamName: streamName,
      PlaybackMode: "LIVE",
      ContainerFormat: "FRAGMENTED_MP4",
      Expires: 3600,
      DiscontinuityMode: "ALWAYS"
    }));
    console.log("✅ URL HLS gerada com sucesso");
    return new Response(JSON.stringify({
      success: true,
      streamName: streamName,
      hlsUrl: hlsResp.HLSStreamingSessionURL,
      expires: "1 hora",
      playbackMode: "LIVE"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (err) {
    console.error("❌ Erro na Edge Function:", err.message);
    console.error("Stack:", err.stack);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      streamName: "teste-manual"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
