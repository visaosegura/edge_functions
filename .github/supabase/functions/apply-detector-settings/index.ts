import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const DETECTOR_WIDTH = 640;
const DETECTOR_HEIGHT = 480;
// ✅ Configurações (Ajuste se necessário)
const SHINOBI_BASE_URL = "https://cloud.visaosegura.seg.br";
const API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM";
const GROUP_KEY = "aMOFHzf8Fk";
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
    const { camera_id } = await req.json();
    if (!camera_id) {
      throw new Error("camera_id obrigatório");
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // =============================
    // 1. BUSCAR DADOS DA CÂMERA
    // =============================
    const { data: camera } = await supabase.from("cameras").select("shinobi_monitor_id, nome, rtsp_url, porta, protocolo, dias_retencao").eq("id", camera_id).single();
    if (!camera?.shinobi_monitor_id) {
      throw new Error("Monitor Shinobi não encontrado para esta câmera");
    }
    const monitorId = camera.shinobi_monitor_id;
    // =============================
    // 2. BUSCAR SETTINGS
    // =============================
    const { data: settings } = await supabase.from("detector_settings").select("*").eq("camera_id", camera_id).single();
    if (!settings) {
      throw new Error("Detector settings não encontrados");
    }
    // =============================
    // 3. BUSCAR REGIÕES
    // =============================
    const { data: regions } = await supabase.from("detector_regions").select(`*, detector_region_points (*)`).eq("camera_id", camera_id).eq("enabled", true);
    // =============================
    // 4. FORMATAR CORDAS (REGIONS)
    // =============================
    const cordsMap = {};
    for (const region of regions || []){
      cordsMap[region.name] = {
        name: region.name,
        sensitivity: region.minimum_change,
        max_sensitivity: region.maximum_change ?? "",
        threshold: region.trigger_threshold,
        color_threshold: region.color_threshold,
        points: (region.detector_region_points || []).sort((a, b)=>a.point_order - b.point_order).map((p)=>[
            Math.round(p.x * DETECTOR_WIDTH),
            Math.round(p.y * DETECTOR_HEIGHT)
          ])
      };
    }
    // =============================
    // 5. BUSCAR FILTROS DE OBJETO
    // =============================
    const { data: objectFilters } = await supabase.from("detector_object_filters").select("label").eq("camera_id", camera_id).eq("enabled", true);
    const objectLabels = objectFilters && objectFilters.length > 0 ? objectFilters.map((o)=>o.label).join(",") : "";
    // =============================
    // 6. CRIAR DETAILS COMPLETO (TEMPLATE BASE)
    // =============================
    // ✅ Usa o mesmo template da função createShinobiMonitor que funciona
    const retentionDays = camera.dias_retencao || 7;
    const storageFolder = `/home/Shinobi/videos/gcp_storage/retencao_${retentionDays}d/${monitorId}`;
    // Parse RTSP URL para extrair credenciais
    let host = "0.0.0.0", user = "", pass = "", path = "/";
    if (camera.rtsp_url) {
      try {
        const urlStr = camera.rtsp_url.replace('rtsp://', 'http://');
        const url = new URL(urlStr);
        host = url.hostname;
        user = decodeURIComponent(url.username || "");
        pass = decodeURIComponent(url.password || "");
        path = url.pathname + url.search;
      } catch (e) {
        console.warn("Erro ao parsear RTSP URL:", e.message);
      }
    }
    const detailsObj = {
      notes: "",
      dir: storageFolder,
      auto_host_enable: "1",
      auto_host: camera.rtsp_url || "",
      rtsp_transport: "tcp",
      muser: user,
      mpass: pass,
      port_force: null,
      fatal_max: "0",
      skip_ping: "1",
      is_onvif: null,
      onvif_port: "",
      primary_input: null,
      aduration: "1000000",
      probesize: "1000000",
      stream_loop: null,
      sfps: "",
      wall_clock_timestamp_ignore: null,
      accelerator: null,
      hwaccel: "cuvid",
      hwaccel_vcodec: "h264_cuvid",
      hwaccel_device: "",
      hwaccel_format: "",
      stream_type: "hls",
      stream_flv_type: "http",
      stream_flv_maxLatency: "",
      stream_mjpeg_clients: "",
      stream_vcodec: "copy",
      stream_acodec: "no",
      hls_time: "2",
      hls_list_size: "3",
      preset_stream: "",
      stream_quality: "1",
      stream_fps: "15",
      stream_scale_x: "1280",
      stream_scale_y: "720",
      stream_rotate: null,
      signal_check: "",
      signal_check_log: null,
      stream_vf: "",
      tv_channel: null,
      tv_channel_id: "temp_wBddA",
      tv_channel_group_title: "",
      stream_timestamp: null,
      stream_timestamp_font: "",
      stream_timestamp_font_size: "",
      stream_timestamp_color: "",
      stream_timestamp_box_color: "",
      stream_timestamp_x: "",
      stream_timestamp_y: "",
      stream_watermark: null,
      stream_watermark_location: "",
      stream_watermark_position: null,
      snap: "1",
      snap_fps: "1",
      snap_scale_x: "1280",
      snap_scale_y: "720",
      snap_vf: "",
      vcodec: "copy",
      crf: "1",
      preset_record: "",
      acodec: "no",
      record_scale_y: "",
      record_scale_x: "",
      cutoff: "",
      rotate: null,
      vf: "",
      timestamp: null,
      timestamp_font: "",
      timestamp_font_size: "",
      timestamp_color: "",
      timestamp_box_color: "",
      timestamp_x: "",
      timestamp_y: "",
      watermark: null,
      watermark_location: "",
      watermark_position: null,
      record_timelapse: null,
      record_timelapse_mp4: null,
      record_timelapse_fps: null,
      record_timelapse_scale_x: "",
      record_timelapse_scale_y: "",
      record_timelapse_vf: "",
      record_timelapse_watermark: null,
      record_timelapse_watermark_location: "",
      record_timelapse_watermark_position: null,
      // ===== CAMPOS DO DETECTOR (ATUALIZADOS) =====
      detector: settings.enabled ? "1" : "0",
      onvif_events: null,
      detector_save: "1",
      use_detector_filters: "1",
      use_detector_filters_object: "1",
      detector_record_method: "sip",
      detector_trigger: settings.trigger_record ? "1" : "0",
      detector_buffer_seconds_before: String(settings.buffer_seconds_before),
      detector_timeout: String(settings.timeout_seconds),
      watchdog_reset: "1",
      detector_delete_motionless_videos: null,
      det_trigger_tags: "",
      detector_http_api: null,
      detector_send_frames: "1",
      detector_fps: "",
      detector_scale_x: String(DETECTOR_WIDTH),
      detector_scale_y: String(DETECTOR_HEIGHT),
      detector_lock_timeout: "",
      detector_send_video_length: "",
      snap_seconds_inward: "",
      // ✅ CORDS como STRING JSON
      cords: JSON.stringify(cordsMap),
      detector_filters: "",
      detector_pam: "1",
      detector_motion_save_frame: null,
      detector_sensitivity: String(settings.sensitivity),
      detector_max_sensitivity: settings.max_sensitivity ? String(settings.max_sensitivity) : "",
      detector_threshold: "",
      detector_color_threshold: "",
      inverse_trigger: null,
      detector_frame: "1",
      detector_motion_tile_mode: "1",
      detector_tile_size: String(settings.tile_size || 10),
      detector_noise_filter: null,
      detector_noise_filter_range: "",
      detector_use_detect_object: settings.use_object ? "1" : "0",
      detectors_selected: [],
      detector_object_ignore_not_move: "1",
      detector_object_move_percent: String(settings.object_min_movement_percent),
      detector_send_frames_object: null,
      detector_obj_count_in_region: null,
      detector_obj_region: settings.require_object_in_region ? "1" : "0",
      detector_use_motion: settings.use_motion ? "1" : "0",
      detector_fps_object: String(settings.object_fps),
      detector_scale_x_object: "",
      detector_scale_y_object: "",
      detectorLineCounter: "1",
      detectorLineCounterTags: "",
      detector_buffer_vcodec: "auto",
      detector_buffer_acodec: null,
      detector_buffer_fps: "",
      event_record_scale_x: "",
      event_record_scale_y: "",
      event_record_aduration: "",
      event_record_probesize: "",
      detector_record_overlap: settings.record_overlap ? "1" : "0",
      detector_audio: null,
      detector_audio_min_db: "",
      detector_audio_max_db: "",
      detectorEventPtz: "1",
      detector_webhook: null,
      detector_webhook_timeout: "",
      detector_webhook_url: "",
      detector_webhook_method: null,
      detector_command_enable: null,
      detector_command: "",
      detector_command_timeout: "",
      detector_notrigger: null,
      detector_notrigger_timeout: "",
      detector_notrigger_discord: null,
      detector_notrigger_webhook: null,
      detector_notrigger_webhook_url: "",
      detector_notrigger_webhook_method: null,
      detector_notrigger_command_enable: null,
      detector_notrigger_command: "",
      detector_notrigger_command_timeout: "",
      // Filtros de objeto
      detector_object_detection: settings.use_object ? "1" : "0",
      detector_object_filter: objectLabels ? "1" : "0",
      detector_object_filter_list: objectLabels,
      control: "1",
      control_base_url: "",
      control_url_method: null,
      onvif_non_standard: null,
      control_digest_auth: null,
      control_axis_lock: "",
      control_stop: null,
      control_url_stop_timeout: "",
      control_turn_speed: "",
      detector_ptz_follow: "1",
      detector_ptz_follow_target: "person",
      control_url_center: "",
      control_url_left: "",
      control_url_left_stop: "",
      control_url_right: "",
      control_url_right_stop: "",
      control_url_up: "",
      control_url_up_stop: "",
      control_url_down: "",
      control_url_down_stop: "",
      control_url_enable_nv: "",
      control_url_disable_nv: "",
      control_url_zoom_out: "",
      control_url_zoom_out_stop: "",
      control_url_zoom_in: "",
      control_url_zoom_in_stop: "",
      control_invert_y: null,
      notify_email: null,
      notify_global_webhook: null,
      notify_emailClient: null,
      notify_onUnexpectedExit: null,
      notify_useRawSnapshot: null,
      detector_mail: null,
      detector_mail_timeout: "",
      detector_notrigger_mail: null,
      detector_emailClient_timeout: "",
      cust_input: "-stimeout 10000000 -rtsp_transport tcp",
      cust_stream: "",
      cust_snap: "",
      cust_snap_raw: "",
      cust_record: "",
      cust_detect: "",
      cust_detect_object: "",
      cust_sip_record: "",
      custom_output: "",
      loglevel: "warning",
      sqllog: null,
      // ✅ SUBSTREAM
      substream: {
        input: {
          type: "h264",
          stream_flv_type: null,
          fulladdress: "",
          sfps: "",
          aduration: "",
          probesize: "",
          stream_loop: null,
          rtsp_transport: "",
          accelerator: "0",
          hwaccel: null,
          hwaccel_vcodec: "",
          hwaccel_device: "",
          cust_input: ""
        },
        output: {
          stream_type: "hls",
          stream_mjpeg_clients: "",
          stream_vcodec: "copy",
          stream_acodec: "no",
          hls_time: "",
          hls_list_size: "",
          preset_stream: "",
          stream_quality: "",
          stream_v_br: "",
          stream_a_br: "",
          stream_fps: "",
          stream_scale_x: "640",
          stream_scale_y: "480",
          stream_rotate: null,
          svf: "",
          cust_stream: ""
        }
      },
      detector_cascades: "",
      stream_channels: "",
      input_maps: [],
      input_map_choices: {
        stream: [],
        snap: [],
        record: [],
        record_timelapse: [],
        detector: [],
        detector_object: [],
        detector_sip_buffer: []
      },
      triggerMonitorsPtzTargets: {},
      detectorLineCounterSettings: {
        lineSpacing: 40,
        refreshRate: 10,
        lines: null,
        upName: "",
        downName: "",
        resetDaily: false
      },
      days: "",
      size: ""
    };
    // =============================
    // 7. MONTAR CONFIG FINAL
    // =============================
    const config = {
      mode: "record",
      mid: monitorId,
      name: camera.nome || `Cam-${camera_id}`,
      type: "h264",
      protocol: camera.protocolo === "RTMP" ? "rtmp" : "rtsp",
      host: host,
      port: String(camera.porta || "554"),
      path: path,
      ext: "mp4",
      fps: "",
      width: "2048",
      height: "1536",
      details: JSON.stringify(detailsObj),
      shto: "[]",
      shfr: "[]"
    };
    console.log(`📋 Regiões configuradas: ${Object.keys(cordsMap).length}`);
    console.log(`📋 Detector ativado: ${detailsObj.detector}`);
    console.log(`📋 Object detection: ${detailsObj.detector_use_detect_object}`);
    console.log(`📋 Filtros de objeto: ${objectLabels || "nenhum"}`);
    // =============================
    // 8. ENVIAR PARA O SHINOBI
    // =============================
    // ✅ Usando /add no final (edita se já existir)
    const apiUrl = `${SHINOBI_BASE_URL}/${API_KEY}/configureMonitor/${GROUP_KEY}/${monitorId}/add`;
    console.log(`📡 Atualizando Monitor: ${monitorId}`);
    console.log(`📡 URL: ${apiUrl}`);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json" // ✅ JSON, não form-urlencoded!
      },
      body: JSON.stringify({
        data: JSON.stringify(config) // ✅ Estrutura: {"data": "..."}
      })
    });
    const raw = await res.text();
    console.log(`📥 Resposta raw:`, raw.substring(0, 500));
    if (!raw.trim().startsWith("{")) {
      throw new Error("Shinobi retornou resposta não-JSON");
    }
    const result = JSON.parse(raw);
    console.log(`📥 Resposta parseada:`, JSON.stringify(result));
    if (!result.ok) {
      console.error("❌ Erro Shinobi:", result);
      throw new Error(result.msg || "Erro ao aplicar detector no Shinobi");
    }
    console.log("✅ Sucesso! Detector atualizado no Shinobi");
    return new Response(JSON.stringify({
      success: true,
      shinobi_response: result,
      regions_synced: Object.keys(cordsMap).length,
      monitor_id: monitorId
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("❌ Erro:", err.message);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
