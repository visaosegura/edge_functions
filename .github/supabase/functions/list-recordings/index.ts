// ==============================================================================
// ⚠️ CONFIGURAÇÕES - REVISE SE NECESSÁRIO
// ==============================================================================
const SHINOBI_BASE_URL = "https://cloud.visaosegura.seg.br";
const API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM";
const GROUP_KEY = "aMOFHzf8Fk";
// Ajuste Fino: Arquivos menores que 100KB geralmente são erros de buffer ou metadados
const MIN_FILE_SIZE_BYTES = 102400; // 100KB
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const payload = await req.json();
    const { camera_id } = payload;
    if (!camera_id) {
      return new Response(JSON.stringify({
        error: "camera_id is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const monitorId = camera_id.replaceAll('-', '');
    // 1. Chamar API com LIMITE ALTO
    // Adicionamos ?limit=10000 para garantir que pegamos TUDO (fragmentos + completos)
    // Sem isso, o Shinobi retorna apenas os últimos registros (o que pode ocultar os completos)
    const shinobiUrl = `${SHINOBI_BASE_URL}/${API_KEY}/videos/${GROUP_KEY}/${monitorId}?limit=10000`;
    console.log(`📡 Buscando vídeos para: ${monitorId} (URL: ${shinobiUrl})`);
    const response = await fetch(shinobiUrl);
    if (!response.ok) {
      throw new Error(`Erro Shinobi: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const rawVideos = data.videos || [];
    console.log(`📥 Total recebido do Shinobi: ${rawVideos.length} arquivos.`);
    // Array para debug de arquivos ignorados
    const ignoredDebug = [];

    // Log do primeiro vídeo para debug
    if (rawVideos.length > 0) {
      console.log(`🔍 Exemplo de vídeo do Shinobi:`, JSON.stringify(rawVideos[0]));
    }
    
    // 2. Filtrar e Formatar
    const videos = rawVideos.filter((v)=>{
      const isValid = v.size > MIN_FILE_SIZE_BYTES;
      if (!isValid && ignoredDebug.length < 5) {
        ignoredDebug.push(`${v.filename} (${v.size} bytes)`);
      }
      return isValid;
    }).map((v)=>{
      const date = new Date(v.time);
      const thumbnailName = v.filename.replace(/\.[^/.]+$/, ".jpg");
      return {
        filename: v.filename,
        timestamp: v.time,
        formatted_date: date.toLocaleString('pt-BR'),
        size: v.size,
        size_formatted: (v.size / 1024 / 1024).toFixed(2) + ' MB',
        duration: v.duration,
        video_url: `${SHINOBI_BASE_URL}/${API_KEY}/videos/${GROUP_KEY}/${monitorId}/${v.filename}`,
        thumbnail_url: `${SHINOBI_BASE_URL}/${API_KEY}/videos/${GROUP_KEY}/${monitorId}/${thumbnailName}`,
        has_preview: true
      };
    });
    console.log(`✅ Total após filtro (>100KB): ${videos.length}. (Ignorados: ${rawVideos.length - videos.length})`);
    if (ignoredDebug.length > 0) console.log(`🗑️ Exemplos ignorados: ${JSON.stringify(ignoredDebug)}`);
    // Ordenar do mais recente para o mais antigo
    videos.sort((a, b)=>new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return new Response(JSON.stringify({
      success: true,
      camera_id: camera_id,
      total_videos: videos.length,
      ignored_count: rawVideos.length - videos.length,
      recordings: videos
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Erro ao listar:", error.message);
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
