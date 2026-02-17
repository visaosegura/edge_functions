import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ==============================================================================
// ⚠️ CONFIGURAÇÕES
// ==============================================================================
// ✅ Configurações do Shinobi (hardcoded)
const SHINOBI_BASE_URL = "https://cloud.visaosegura.seg.br";
const API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM";
const GROUP_KEY = "aMOFHzf8Fk";
const RTMP_INGEST_DOMAIN = "cloud.visaosegura.seg.br" // Domínio de ingestão (sem http)
;
// URL da função que RECEBE os eventos
const EVENTS_WEBHOOK_URL = "https://dqiripuqzkikppmyfyuu.supabase.co/functions/v1/shinobi-events";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  console.log("🚀 Edge Function iniciada...");
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    if (req.method !== 'POST') {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }
    const payload = await req.json();
    const { type, record, old_record } = payload;
    if (!type || !record && !old_record) {
      return new Response(JSON.stringify({
        error: "Invalid Payload"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    const camId = record?.id || old_record?.id;
    console.log(`🔔 Evento Supabase: ${type} | ID Câmera: ${camId}`);
    if (type === 'INSERT') {
      return await handleShinobiWorkflow(record, supabase);
    } else if (type === 'DELETE') {
      await deleteMonitor(old_record);
    } else if (type === 'UPDATE') {
      const needsUpdate = record.rtsp_url !== old_record.rtsp_url || record.nome !== old_record.nome || record.porta !== old_record.porta || record.dias_retencao !== old_record.dias_retencao || record.protocolo !== old_record.protocolo;
      if (needsUpdate) {
        console.log("🔄 Update detectado, reiniciando workflow...");
        return await handleShinobiWorkflow(record, supabase);
      }
    }
    return new Response(JSON.stringify({
      success: true
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
async function handleShinobiWorkflow(cam, supabase) {
  const camId = cam.id;
  await supabase.from('camera_jobs').upsert({
    camera_id: camId,
    status: 'PROCESSING',
    error_message: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  });
  try {
    const result = await createShinobiMonitor(cam);
    // Verifica se a resposta do Shinobi indica sucesso (ok: true)
    if (result && result.ok === true) {
      const monitorId = camId.replaceAll('-', '');
      console.log(`💾 Atualizando tabela cameras. Monitor: ${monitorId}`);
      await supabase.from('cameras').update({
        shinobi_monitor_id: monitorId,
        shinobi_group_key: GROUP_KEY,
        shinobi_host: SHINOBI_BASE_URL,
        status: 'online',
        rtmp_ingest_url: result.rtmp_url || null
      }).eq('id', camId);
      await supabase.from('camera_jobs').update({
        status: 'DONE',
        updated_at: new Date().toISOString()
      }).eq('camera_id', camId);
      console.log(`✅ Câmera ${monitorId} criada com sucesso.`);
      return new Response(JSON.stringify({
        success: true,
        rtmp: result.is_rtmp ? {
          server_url: result.rtmp_server,
          stream_key: result.stream_key,
          full_url: result.rtmp_url
        } : null
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      throw new Error(result.msg || "Erro na API do Shinobi");
    }
  } catch (err) {
    console.error(`❌ Falha no Workflow: ${err.message}`);
    await supabase.from('camera_jobs').update({
      status: 'ERROR',
      error_message: err.message,
      updated_at: new Date().toISOString()
    }).eq('camera_id', camId);
    await supabase.from('cameras').update({
      status: 'offline'
    }).eq('id', camId);
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
}
async function createShinobiMonitor(cam) {
  const monitorId = cam.id.replaceAll('-', '');
  const isRTMP = cam.protocolo === 'RTMP';
  let host = "0.0.0.0", user = "", pass = "", path = "/", portStr = "554";
  let protocol = "rtsp";
  let monitorType = "h264";
  let autoHostUrl = "";
  let rtmpServer = "";
  let rtmpFullUrl = "";
  let streamKey = "";
  if (isRTMP) {
    // --- LÓGICA RTMP ---
    protocol = "rtmp";
    monitorType = "rtmp";
    host = "127.0.0.1";
    portStr = "1935";
    streamKey = crypto.randomUUID().split('-')[0];
    const rtmpPath = `/${GROUP_KEY}_${monitorId}_${streamKey}`;
    path = rtmpPath;
    autoHostUrl = `rtmp://127.0.0.1:1935${rtmpPath}`;
    rtmpServer = `rtmp://${RTMP_INGEST_DOMAIN}:1935`;
    rtmpFullUrl = `${rtmpServer}${rtmpPath}`;
    console.log(`📡 Modo RTMP ativado.`);
  } else {
    // --- LÓGICA RTSP ---
    const masterUrl = cam.rtsp_url;
    if (!masterUrl) return {
      ok: false,
      msg: "RTSP URL vazia."
    };
    autoHostUrl = masterUrl;
    protocol = "rtsp";
    monitorType = "h264";
    try {
      const urlStr = masterUrl.startsWith('rtsp') ? masterUrl.replace('rtsp://', 'http://') : masterUrl;
      const url = new URL(urlStr);
      host = url.hostname;
      user = decodeURIComponent(url.username);
      pass = decodeURIComponent(url.password);
      path = url.pathname + url.search;
      portStr = cam.porta ? String(cam.porta) : url.port || "554";
    } catch (e) {
      console.error("Erro no parse da URL:", e.message);
      portStr = cam.porta ? String(cam.porta) : "554";
    }
  }
  // ✅ CÁLCULO DA PASTA E DIAS (RETENÇÃO)
  // Padrão 3 dias se não informado
  const retentionDays = String(cam.dias_retencao || 3);
  const storageFolder = `/home/Shinobi/videos/gcp_storage/retencao_${retentionDays}d/`;
  console.log(`📂 Configurando diretório: ${storageFolder} (Plano: ${retentionDays} dias)`);
  // ✅ JSON DETAILS CONFIGURADO PARA TENSORFLOW E RETENÇÃO
  const detailsObj = {
    // Configurações de Retenção
    max_keep_days: retentionDays,
    notes: `Plano: ${retentionDays}`,
    dir: storageFolder,
    // Configurações Gerais
    ptz_id: "",
    auto_compress_videos: null,
    geolocation: "49.2578298,-123.2634732,4,90,60,1",
    rtmp_key: streamKey || "",
    auto_host_enable: "1",
    auto_host: autoHostUrl,
    rtsp_transport: isRTMP ? "" : "tcp",
    muser: user,
    mpass: pass,
    port_force: null,
    fatal_max: "10",
    skip_ping: "1",
    is_onvif: null,
    onvif_port: "",
    primary_input: null,
    // Performance e Estabilidade
    aduration: "1000000",
    probesize: "1000000",
    stream_loop: null,
    sfps: "",
    wall_clock_timestamp_ignore: "1",
    // Hardware Acceleration
    accelerator: null,
    hwaccel: "cuvid",
    hwaccel_vcodec: "h264_cuvid",
    hwaccel_device: "",
    hwaccel_format: "",
    // Stream Output (HLS)
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
    signal_check: "15",
    signal_check_log: "1",
    stream_vf: "",
    tv_channel: null,
    tv_channel_id: "temp_4vMME",
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
    // Snapshot
    snap: "1",
    snap_fps: "1",
    snap_scale_x: "1280",
    snap_scale_y: "720",
    snap_vf: "",
    // Recording
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
    // ✅ CONFIGURAÇÃO DO DETECTOR (TENSORFLOW)
    detector: "1",
    onvif_events: null,
    detector_save: "1",
    use_detector_filters: null,
    use_detector_filters_object: null,
    detector_record_method: "sip",
    detector_trigger: "1",
    detector_buffer_seconds_before: "",
    detector_timeout: "10",
    watchdog_reset: null,
    detector_delete_motionless_videos: null,
    det_trigger_tags: "",
    detector_http_api: null,
    detector_send_frames: "1",
    detector_fps: "2",
    detector_scale_x: "640",
    detector_scale_y: "480",
    detector_lock_timeout: "",
    detector_send_video_length: "",
    snap_seconds_inward: "",
    cords: "{\"Region Name\":{\"name\":\"Region Name\",\"sensitivity\":10,\"max_sensitivity\":\"\",\"threshold\":1,\"color_threshold\":9,\"points\":[[0,0],[0,288],[384,288],[571,209],[384,0],[276,53]]}}",
    detector_filters: "",
    detector_pam: "1",
    detector_motion_save_frame: "1",
    detector_sensitivity: "10",
    detector_max_sensitivity: "",
    detector_threshold: "",
    detector_color_threshold: "",
    inverse_trigger: "1",
    detector_frame: "1",
    detector_motion_tile_mode: null,
    detector_tile_size: "20",
    detector_noise_filter: null,
    detector_noise_filter_range: "",
    // ✅ ATIVAÇÃO DA IA (TENSORFLOW)
    detector_use_detect_object: "1",
    detectors_selected: [
      "Tensorflow"
    ],
    detector_object_ignore_not_move: null,
    detector_object_move_percent: "",
    detector_send_frames_object: "1",
    detector_obj_count_in_region: null,
    detector_obj_region: null,
    detector_use_motion: "1",
    detector_fps_object: "2",
    detector_scale_x_object: "1280",
    detector_scale_y_object: "720",
    detectorLineCounter: null,
    detectorLineCounterTags: "",
    detector_buffer_vcodec: "copy",
    detector_buffer_acodec: null,
    detector_buffer_fps: "",
    event_record_scale_x: "",
    event_record_scale_y: "",
    event_record_aduration: "",
    event_record_probesize: "",
    detector_record_overlap: null,
    detector_audio: null,
    detector_audio_min_db: "",
    detector_audio_max_db: "",
    detectorEventPtz: null,
    // ✅ WEBHOOK LOCAL (PROXY)
    detector_webhook: "1",
    detector_webhook_timeout: "",
    detector_webhook_url: "http://127.0.0.1:3333/?type={{INNER_EVENT_TITLE}}&data={{INNER_EVENT_INFO}}",
    detector_webhook_method: "POST",
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
    control: null,
    control_base_url: "",
    control_url_method: null,
    onvif_non_standard: null,
    control_digest_auth: null,
    control_axis_lock: "",
    control_stop: null,
    control_url_stop_timeout: "",
    control_turn_speed: "",
    detector_ptz_follow: null,
    detector_ptz_follow_target: "",
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
    // Notificações e Input Customizado
    notify_global_webhook: "1",
    notify_emailClient: null,
    notify_onUnexpectedExit: null,
    notify_useRawSnapshot: null,
    detector_emailClient_timeout: "",
    cust_input: isRTMP ? "-rw_timeout 10000000 -fflags nobuffer" : "-rtsp_transport tcp -stimeout 10000000 -use_wallclock_as_timestamps 1 -fflags +igndts -fflags +genpts",
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
    substream: {
      "input": {
        "type": "h264",
        "stream_flv_type": null,
        "fulladdress": "",
        "sfps": "",
        "aduration": "",
        "probesize": "",
        "stream_loop": null,
        "rtsp_transport": "",
        "accelerator": "0",
        "hwaccel": null,
        "hwaccel_vcodec": "",
        "hwaccel_device": "",
        "cust_input": ""
      },
      "output": {
        "stream_type": "hls",
        "stream_mjpeg_clients": "",
        "stream_vcodec": "copy",
        "stream_acodec": "no",
        "hls_time": "",
        "hls_list_size": "",
        "preset_stream": "",
        "stream_quality": "",
        "stream_v_br": "",
        "stream_a_br": "",
        "stream_fps": "",
        "stream_scale_x": "640",
        "stream_scale_y": "480",
        "stream_rotate": null,
        "svf": "",
        "cust_stream": ""
      }
    },
    detector_cascades: "",
    stream_channels: "",
    input_maps: [],
    input_map_choices: {
      "stream": [],
      "snap": [],
      "record": [],
      "record_timelapse": [],
      "detector": [],
      "detector_object": [],
      "detector_sip_buffer": []
    },
    triggerMonitorsPtzTargets: {},
    detectorLineCounterSettings: {
      "lineSpacing": 40,
      "refreshRate": 10,
      "lines": null,
      "upName": "",
      "downName": "",
      "resetDaily": false
    },
    days: "",
    size: ""
  };
  const config = {
    mode: "record",
    mid: monitorId,
    name: cam.nome || `Cam-${cam.id}`,
    tags: "",
    type: monitorType,
    protocol: protocol,
    host: host,
    port: String(portStr),
    path: path,
    ext: "mp4",
    fps: "",
    width: "2048",
    height: "1536",
    details: JSON.stringify(detailsObj),
    shto: "[]",
    shfr: "[]",
    substreams: JSON.stringify([
      {
        vcodec: "copy",
        acodec: "no",
        fps: "15",
        width: "1280",
        height: "720"
      }
    ])
  };
  const apiUrl = `${SHINOBI_BASE_URL}/${API_KEY}/configureMonitor/${GROUP_KEY}/${monitorId}/add`;
  console.log(`📤 Enviando Payload Final para Shinobi...`);
  const params = new URLSearchParams();
  params.append('data', JSON.stringify(config));
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const raw = await res.text();
    if (!raw.trim().startsWith("{")) {
      throw new Error("Shinobi returned non-JSON response");
    }
    const data = JSON.parse(raw);
    if (data.ok && isRTMP) {
      data.is_rtmp = true;
      data.rtmp_url = rtmpFullUrl;
      data.rtmp_server = rtmpServer;
      data.stream_key = streamKey;
    }
    return data;
  } catch (err) {
    console.error("❌ Erro na comunicação HTTP com Shinobi:", err.message);
    return {
      ok: false,
      msg: err.message
    };
  }
}
async function deleteMonitor(cam) {
  if (!cam?.id) return;
  const monitorId = cam.id.replaceAll('-', '');
  const url = `${SHINOBI_BASE_URL}/${API_KEY}/configureMonitor/${GROUP_KEY}/${monitorId}/delete`;
  await fetch(url).catch((err)=>console.error("Erro ao deletar:", err.message));
}
