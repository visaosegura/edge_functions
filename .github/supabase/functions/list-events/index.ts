// ==============================================================================
// ⚠️ CONFIGURAÇÕES (Mesmas da outra function)
// ==============================================================================
const SHINOBI_BASE_URL = "https://cloud.visaosegura.seg.br";
const API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM";
const GROUP_KEY = "aMOFHzf8Fk";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  // Tratamento de CORS
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const payload = await req.json();
    const { camera_id, start, end, limit } = payload;
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
    // 1. Sanitizar ID
    const monitorId = camera_id.replaceAll('-', '');
    // 2. Construir URL com Filtros
    // Endpoint: /:apiKey/events/:groupKey/:monitorId
    const url = new URL(`${SHINOBI_BASE_URL}/${API_KEY}/events/${GROUP_KEY}/${monitorId}`);
    // Filtro de Data (Padrão: Últimas 24h se não informado)
    if (start) {
      url.searchParams.append("start", start);
    } else {
      // Fallback: Pega eventos de ontem para hoje
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      url.searchParams.append("start", yesterday.toISOString());
    }
    if (end) {
      url.searchParams.append("end", end);
    }
    // Limite de registros (Padrão Shinobi costuma ser alto, vamos limitar para o frontend não travar)
    const limitResults = limit || "100";
    url.searchParams.append("limit", limitResults);
    console.log(`📡 Buscando eventos Shinobi: ${url.toString()}`);
    // 3. Buscar Dados
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Erro Shinobi: ${response.status} ${response.statusText}`);
    }
    const rawData = await response.json();
    // 4. Formatar para o Frontend
    // O Shinobi retorna um array de eventos. Vamos limpar e padronizar.
    const events = Array.isArray(rawData) ? rawData.map((e)=>{
      // Tenta extrair detalhes se for string JSON
      let details = {};
      try {
        details = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
      } catch  {}
      return {
        id: e.id,
        time: e.time,
        type: details.reason || "motion",
        confidence: details.confidence || null,
        object_name: details.tag || null,
        // Link para ver o frame exato (se existir)
        snapshot_url: `${SHINOBI_BASE_URL}/${API_KEY}/jpeg/${GROUP_KEY}/${monitorId}/${e.time}`,
        details: details
      };
    }) : [];
    // Ordenar do mais recente para o mais antigo
    events.sort((a, b)=>new Date(b.time).getTime() - new Date(a.time).getTime());
    return new Response(JSON.stringify({
      success: true,
      count: events.length,
      monitor_id: monitorId,
      events: events
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Erro ao listar eventos:", error.message);
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
