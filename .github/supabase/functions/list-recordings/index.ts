import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const SHINOBI_BASE_URL = "https://cloud.visaosegura.seg.br"
const API_KEY = "5tc4VYGpqkBLVNEkdp3yIoFS3m9ZKM"
const GROUP_KEY = "aMOFHzf8Fk" 

// Ajuste Fino: Arquivos menores que 100KB geralmente são erros de buffer ou metadados
const MIN_FILE_SIZE_BYTES = 102400; // 100KB

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const payload = await req.json()
    const { camera_id } = payload

    if (!camera_id) {
      return new Response(JSON.stringify({ error: "camera_id is required" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      })
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

    // ========================================
    // 🔍 DEBUG COMPLETO DO PRIMEIRO VÍDEO
    // ========================================
    if (rawVideos.length > 0) {
      const exemplo = rawVideos[0];
      console.log(`🔍 ========== ESTRUTURA COMPLETA DO VÍDEO ==========`);
      console.log(`📄 JSON completo:`, JSON.stringify(exemplo, null, 2));
      console.log(`📋 Campos disponíveis:`, Object.keys(exemplo).join(', '));
      console.log(`⏱️ Campo duration:`, exemplo.duration, `(tipo: ${typeof exemplo.duration})`);
      console.log(`⏱️ Campo end:`, exemplo.end, `(tipo: ${typeof exemplo.end})`);
      console.log(`⏱️ Campo time:`, exemplo.time, `(tipo: ${typeof exemplo.time})`);
      console.log(`⏱️ Campo status:`, exemplo.status, `(tipo: ${typeof exemplo.status})`);
      console.log(`⏱️ Campo details:`, exemplo.details ? '(existe)' : '(não existe)');
      console.log(`📦 Size:`, exemplo.size, 'bytes');
      console.log(`🔍 ================================================`);
    }

    // 2. Filtrar e Formatar
    const videos = rawVideos
      .filter((v: any) => {
        const isValid = v.size > MIN_FILE_SIZE_BYTES;
        if (!isValid && ignoredDebug.length < 5) {
            ignoredDebug.push(`${v.filename} (${v.size} bytes)`);
        }
        return isValid;
      })
      .map((v: any) => {
        const date = new Date(v.time);
        const thumbnailName = v.filename.replace(/\.[^/.]+$/, ".jpg");

        // ========================================
        // EXTRAÇÃO DE DURAÇÃO COM DEBUG COMPLETO
        // ========================================
        let duration = 0;
        let durationSource = 'NONE';
        
        console.log(`\n🎬 Processando: ${v.filename}`);
        
        // 1️⃣ Tentar usar o campo duration direto
        console.log(`  [1] Testando campo duration: ${v.duration} (tipo: ${typeof v.duration})`);
        if (v.duration !== undefined && v.duration !== null) {
          const parsed = Number(v.duration);
          console.log(`      → Convertido para número: ${parsed}`);
          if (!isNaN(parsed) && parsed > 0) {
            duration = parsed;
            durationSource = 'duration field';
            console.log(`      ✅ SUCESSO! Duração: ${duration}s`);
          } else {
            console.log(`      ❌ Valor inválido após conversão`);
          }
        } else {
          console.log(`      ❌ Campo não existe ou é null`);
        }
        
        // 2️⃣ Tentar calcular pela diferença entre end e time (MÉTODO PRINCIPAL PARA SHINOBI)
        if (duration === 0 && v.end && v.time) {
          console.log(`  [2] Testando cálculo end-time:`);
          console.log(`      time: ${v.time} (tipo: ${typeof v.time})`);
          console.log(`      end: ${v.end} (tipo: ${typeof v.end})`);
          
          try {
            const startDate = new Date(v.time);
            const endDate = new Date(v.end);
            
            // Validar se as datas são válidas
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              console.log(`      ❌ Datas inválidas após conversão`);
              console.log(`      startDate: ${startDate}, endDate: ${endDate}`);
            } else {
              const startMs = startDate.getTime();
              const endMs = endDate.getTime();
              
              console.log(`      → start timestamp: ${startMs}`);
              console.log(`      → end timestamp: ${endMs}`);
              console.log(`      → diferença: ${endMs - startMs}ms`);
              
              const calculated = Math.floor((endMs - startMs) / 1000);
              console.log(`      → calculado: ${calculated}s`);
              
              // Aceitar qualquer valor >= 0 (alguns vídeos podem ter menos de 1 segundo)
              if (calculated >= 0) {
                duration = calculated > 0 ? calculated : 1; // Mínimo 1 segundo
                durationSource = 'end-time calculation';
                console.log(`      ✅ SUCESSO! Duração: ${duration}s`);
              } else {
                console.log(`      ❌ Diferença negativa: ${calculated}s`);
              }
            }
          } catch (e: any) {
            console.log(`      ❌ Erro ao calcular: ${e.message}`);
            console.log(`      Stack: ${e.stack}`);
          }
        } else if (duration === 0) {
          console.log(`  [2] ❌ Pulando - campos ausentes (time: ${!!v.time}, end: ${!!v.end})`);
        }
        
        // 3️⃣ [REMOVIDO] Status não contém duração no Shinobi (é apenas um flag: 1=não lido, 2=lido)
        if (duration === 0) {
          console.log(`  [3] ⏭️ Pulando campo status (não contém duração, apenas flag de leitura)`);
        }
        
        // 4️⃣ Usar campo details se disponível
        if (duration === 0 && v.details) {
          console.log(`  [4] Testando campo details:`);
          console.log(`      Tipo: ${typeof v.details}`);
          
          try {
            // Details pode vir como objeto ou string JSON
            const details = typeof v.details === 'string' ? JSON.parse(v.details) : v.details;
            console.log(`      → Details keys:`, Object.keys(details).join(', '));
            console.log(`      → Details completo:`, JSON.stringify(details));
            
            if (details.duration && !isNaN(Number(details.duration))) {
              duration = Number(details.duration);
              durationSource = 'details.duration';
              console.log(`      ✅ SUCESSO! Duração: ${duration}s`);
            } else {
              console.log(`      ❌ details.duration não existe ou inválido`);
            }
          } catch (e: any) {
            console.log(`      ❌ Erro ao processar details: ${e.message}`);
          }
        } else if (duration === 0 && !v.details) {
          console.log(`  [4] ⏭️ Pulando - campo details não existe`);
        }
        
        // 5️⃣ Fallback: Estimar baseado no tamanho do arquivo
        if (duration === 0) {
          const sizeInBytes = v.size || 0;
          const sizeInMB = sizeInBytes / (1024 * 1024);
          console.log(`  [5] FALLBACK - Estimando por tamanho: ${sizeInBytes} bytes (${sizeInMB.toFixed(2)} MB)`);
          
          if (sizeInBytes === 0) {
            duration = 1;
            durationSource = 'fallback (no size)';
            console.log(`      ⚠️ Sem tamanho: fixado em 1s`);
          } else if (sizeInMB < 0.5) {
            // Fragmentos muito pequenos: 10-30 segundos
            duration = 15;
            durationSource = 'estimated (fragment)';
            console.log(`      ⚠️ Fragmento pequeno: fixado em 15s`);
          } else {
            // Cálculo baseado no exemplo real:
            // 2086661 bytes (2 MB) = 27 segundos → ~0.075 MB/s (600 Kbps)
            // Vamos usar 0.08 MB/s como padrão (640 Kbps) para vídeos de segurança
            const estimatedSeconds = Math.floor(sizeInMB / 0.08);
            duration = Math.max(10, estimatedSeconds);
            durationSource = 'estimated (file size)';
            console.log(`      ⚠️ Estimado: ${duration}s (${sizeInMB.toFixed(2)}MB ÷ 0.08MB/s)`);
          }
        }
        
        console.log(`  ✅ FINAL: duration=${duration}s, source=${durationSource}\n`);

        const recording = {
          filename: v.filename,
          timestamp: v.time,
          formatted_date: date.toLocaleString('pt-BR'),
          size: v.size,
          size_formatted: (v.size / 1024 / 1024).toFixed(2) + ' MB',
          duration: duration,
          duration_source: durationSource,
          video_url: `${SHINOBI_BASE_URL}/${API_KEY}/videos/${GROUP_KEY}/${monitorId}/${v.filename}`,
          thumbnail_url: `${SHINOBI_BASE_URL}/${API_KEY}/videos/${GROUP_KEY}/${monitorId}/${thumbnailName}`,
          has_preview: true 
        };
        
        // Log do objeto final que será retornado
        console.log(`📦 Objeto retornado: duration=${recording.duration}, source=${recording.duration_source}`);
        
        return recording;
      });

    console.log(`✅ Total após filtro (>100KB): ${videos.length}. (Ignorados: ${rawVideos.length - videos.length})`);
    if (ignoredDebug.length > 0) console.log(`🗑️ Exemplos ignorados: ${JSON.stringify(ignoredDebug)}`);

    // Log de estatísticas de duração para debug
    const durationsStats = {
      zero: videos.filter((v: any) => v.duration === 0).length,
      estimated: videos.filter((v: any) => v.duration > 0 && v.duration < 30).length,
      valid: videos.filter((v: any) => v.duration >= 30).length
    };
    console.log(`📊 Estatísticas de duração: Zero=${durationsStats.zero}, Estimados=${durationsStats.estimated}, Válidos=${durationsStats.valid}`);

    // Ordenar do mais recente para o mais antigo
    videos.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // ========================================
    // 🔍 LOG FINAL - O QUE VAI PARA O FRONTEND
    // ========================================
    if (videos.length > 0) {
      console.log(`\n📤 ========== ENVIANDO PARA FRONTEND ==========`);
      console.log(`📊 Total de vídeos: ${videos.length}`);
      console.log(`📄 Primeiro vídeo enviado:`);
      console.log(`   - filename: ${videos[0].filename}`);
      console.log(`   - duration: ${videos[0].duration} (tipo: ${typeof videos[0].duration})`);
      console.log(`   - duration_source: ${videos[0].duration_source}`);
      console.log(`   - size: ${videos[0].size_formatted}`);
      console.log(`   - timestamp: ${videos[0].timestamp}`);
      console.log(`📤 ============================================\n`);
    }

    const response = {
      success: true,
      camera_id: camera_id,
      total_videos: videos.length,
      ignored_count: rawVideos.length - videos.length,
      recordings: videos,
      _debug: {
        timestamp: new Date().toISOString(),
        function_version: '2.0-full-debug',
        sample_duration: videos.length > 0 ? videos[0].duration : null,
        sample_source: videos.length > 0 ? videos[0].duration_source : null
      }
    };

    console.log(`\n✅ ========== RESPOSTA FINAL ==========`);
    console.log(`📊 Total vídeos: ${videos.length}`);
    console.log(`🕐 Timestamp: ${response._debug.timestamp}`);
    console.log(`🔢 Sample duration: ${response._debug.sample_duration}`);
    console.log(`🔍 Sample source: ${response._debug.sample_source}`);
    console.log(`✅ ====================================\n`);

    return new Response(JSON.stringify(response), { 
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "X-Function-Version": "2.0-full-debug" 
      } 
    });

  } catch (error: any) {
    console.error("❌ Erro ao listar:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
})
