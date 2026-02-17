import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ============================================
// CONFIGURAÇÕES DO SHINOBI
// ============================================
// Atenção: Idealmente, coloque isso em Env Vars, mas deixei aqui para facilitar seu teste agora.
const SHINOBI_HOST = "http://179.48.12.62:8080";
const SHINOBI_API_KEY = "5tc4VYGpqkBLVNEkdp3yloFS3m9ZKM";
const SHINOBI_GROUP_KEY = "aMOFHzf8Fk";
// ============================================
// CONFIGURAÇÕES SUPABASE
// ============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // Necessário para escrita se o RLS bloquear
const CAMERA_BRANDS = {
  'intelbras': {
    name: 'Intelbras',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/cam/realmonitor?channel={channel}&subtype=0',
      'rtsp://{user}:{pass}@{ip}:{port}/streaming/channels/{channel}'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'hikvision': {
    name: 'Hikvision',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/Streaming/Channels/{channel}01'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'dahua': {
    name: 'Dahua',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/cam/realmonitor?channel={channel}&subtype=0'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'giga': {
    name: 'Giga Security',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/video.h264',
      'rtsp://{user}:{pass}@{ip}:{port}/{channel}'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'tecvoz': {
    name: 'Tecvoz',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/cam0_0',
      'rtsp://{user}:{pass}@{ip}:{port}/channel{channel}'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'jfl': {
    name: 'JFL Alarmes',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/11'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'onvif': {
    name: 'ONVIF (Genérico)',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/onvif{channel}'
    ],
    defaultPort: 554,
    defaultChannel: 1
  },
  'generic': {
    name: 'Genérica',
    formats: [
      'rtsp://{user}:{pass}@{ip}:{port}/stream{channel}',
      'rtsp://{user}:{pass}@{ip}:{port}/live',
      'rtsp://{user}:{pass}@{ip}:{port}/h264'
    ],
    defaultPort: 554,
    defaultChannel: 1
  }
};
// ============================================
// HELPER FUNCTIONS
// ============================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
// Gera um ID curto para o Shinobi (ex: cam_Ab3dE)
function generateShinobiMonitorId() {
  const random = Math.random().toString(36).substring(2, 7);
  return `cam_${random}`;
}
// Função para validar IP
function isValidIP(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Regex.test(ip);
}
// Função de construção de URL RTSP (Sua lógica original)
function buildRtspUrl(config) {
  const marca = config.marca.toLowerCase();
  const brand = CAMERA_BRANDS[marca] || CAMERA_BRANDS['generic'];
  const port = config.porta || brand.defaultPort;
  const channel = config.canal || brand.defaultChannel;
  const user = config.usuario || 'admin';
  const pass = config.senha || '';
  const formatIndex = config.formato_index || 0;
  const format = brand.formats[formatIndex] || brand.formats[0];
  let url = format.replace('{user}', encodeURIComponent(user)).replace('{pass}', encodeURIComponent(pass)).replace('{ip}', config.ip).replace('{port}', String(port)).replace('{channel}', String(channel));
  if (marca === 'hikvision') {
    url = url.replace('{channel}01', String(channel * 100 + 1));
  }
  return {
    url,
    info: {
      marca: brand.name,
      porta: port,
      usuario: user,
      senha: pass,
      host: config.ip,
      path: url.split(String(port))[1] || "" // Tenta extrair o path
    }
  };
}
// ============================================
// MAIN LOGIC
// ============================================
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();
    console.log("📥 Payload recebido:", payload);
    const { id_cliente, nome, marca, ip } = payload;
    // 1. Validações Básicas
    if (!id_cliente || !nome || !marca || !ip) {
      return jsonResponse({
        success: false,
        message: "Campos obrigatórios: id_cliente, nome, marca, ip"
      }, 400);
    }
    if (!isValidIP(ip)) {
      return jsonResponse({
        success: false,
        message: "IP inválido"
      }, 400);
    }
    // 2. Construir URL RTSP
    const rtspData = buildRtspUrl({
      marca,
      ip,
      porta: payload.porta,
      usuario: payload.usuario,
      senha: payload.senha,
      canal: payload.canal
    });
    const monitorId = generateShinobiMonitorId();
    // 3. Criar Monitor no Shinobi via API
    // Documentação Shinobi: POST /[API_KEY]/monitor/[GROUP_KEY]
    console.log(`🎥 Criando monitor no Shinobi: ${monitorId} (${SHINOBI_HOST})`);
    const shinobiConfig = {
      mid: monitorId,
      name: nome,
      mode: "record",
      type: "h264",
      protocol: "rtsp",
      host: ip,
      port: rtspData.info.porta || "554",
      path: rtspData.info.path || "",
      width: "640",
      height: "480",
      fps: "15",
      details: {
        user: rtspData.info.usuario,
        password: rtspData.info.senha,
        auto_host_enable: "1",
        rtsp_transport: "tcp",
        muser: rtspData.info.usuario,
        mpass: rtspData.info.senha // Senha para controle
      }
    };
    // Caso o path extraction falhe, usamos a Full URL no Shinobi (funciona também)
    // Mas vamos tentar enviar estruturado primeiro.
    const shinobiUrl = `${SHINOBI_HOST}/${SHINOBI_API_KEY}/monitor/${SHINOBI_GROUP_KEY}`;
    const shinobiResponse = await fetch(shinobiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(shinobiConfig)
    });
    const shinobiResult = await shinobiResponse.json();
    if (shinobiResult.ok === false) {
      console.error("Erro Shinobi:", shinobiResult);
      throw new Error("Falha ao criar monitor no Shinobi: " + JSON.stringify(shinobiResult));
    }
    console.log("✅ Monitor criado no Shinobi com sucesso!");
    // 4. Salvar no Supabase
    const insertData = {
      id_cliente,
      nome,
      status: 'online',
      // Dados de Conexão Shinobi (NOVOS CAMPOS)
      shinobi_monitor_id: monitorId,
      shinobi_group_key: SHINOBI_GROUP_KEY,
      shinobi_host: SHINOBI_HOST,
      // Dados Legado / Informacionais
      marca: rtspData.info.marca,
      ip_address: ip,
      rtsp_url: rtspData.url,
      // Campos opcionais do payload
      descricao: payload.descricao,
      totem_id: payload.totem_id || `totem-${id_cliente.substring(0, 6)}`
    };
    const { data, error } = await supabase.from("cameras").insert(insertData).select().single();
    if (error) {
      // Se der erro no banco, deveríamos tentar deletar do Shinobi? 
      // Por enquanto, apenas logamos o erro.
      console.error("❌ Erro ao salvar no Supabase:", error);
      throw error;
    }
    // 5. Retornar Sucesso
    return jsonResponse({
      success: true,
      message: "Câmera configurada com sucesso!",
      data: {
        camera_id: data.id,
        shinobi_id: monitorId,
        rtsp_generated: rtspData.url,
        streaming_url: `${SHINOBI_HOST}/${SHINOBI_API_KEY}/hls/${SHINOBI_GROUP_KEY}/${monitorId}/s.m3u8`
      }
    });
  } catch (error) {
    console.error("💥 Erro Geral:", error);
    return jsonResponse({
      success: false,
      message: error.message || "Erro interno no servidor"
    }, 500);
  }
});
