import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const payload = await req.json();
    const monitorId = payload.monitor_id;
    const detectedAt = payload.time;
    const matrices = payload.details?.matrices || [];
    if (!monitorId || matrices.length === 0) {
      return new Response("Evento ignorado", {
        headers: corsHeaders
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // Buscar câmera pelo monitor
    const { data: camera } = await supabase.from("cameras").select("id").eq("shinobi_monitor_id", monitorId).single();
    if (!camera) {
      throw new Error("Câmera não encontrada");
    }
    for (const obj of matrices){
      const label = obj.tag;
      const confidence = obj.confidence;
      const regionName = obj.region || null;
      // Verificar filtro
      const { data: filter } = await supabase.from("detector_object_filters").select("min_confidence").eq("camera_id", camera.id).eq("label", label).eq("enabled", true).single();
      if (!filter) continue;
      if (confidence < filter.min_confidence) continue;
      // Salvar evento
      await supabase.from("detector_events").insert({
        camera_id: camera.id,
        monitor_id: monitorId,
        label,
        confidence,
        region_name: regionName,
        detected_at: detectedAt
      });
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Erro detector-events:", err.message);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
