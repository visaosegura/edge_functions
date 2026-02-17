import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KinesisVideoClient, CreateStreamCommand, DescribeStreamCommand } from "npm:@aws-sdk/client-kinesis-video@3";
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from "npm:@aws-sdk/client-s3@3";
// ============================================
// CONFIGURAÇÕES
// ============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const AWS_REGION = Deno.env.get("AWS_REGION") || "us-east-2";
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const STREAMING_BASE_URL = Deno.env.get("STREAMING_BASE_URL") || "https://rtspserver.zeusvision.com.br";
// ============================================
// CLIENTS AWS
// ============================================
const awsCredentials = {
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY
};
const kinesisClient = new KinesisVideoClient({
  region: AWS_REGION,
  credentials: awsCredentials
});
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: awsCredentials
});
// ============================================
// HELPER FUNCTIONS
// ============================================
function buildSupabaseClient(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
    }
  });
}
/**
 * Extrai informações da URL RTSP
 * Exemplo: rtsp://admin:senha123@192.168.1.100:554/stream/channel1
 */ function parseRtspUrl(rtspUrl) {
  try {
    const url = new URL(rtspUrl);
    return {
      protocol: url.protocol.replace(':', ''),
      username: url.username || null,
      password: url.password || null,
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : 554,
      path: url.pathname
    };
  } catch (error) {
    console.error("Erro ao parsear RTSP URL:", error);
    return null;
  }
}
/**
 * Gera ID único para câmera
 */ function generateCameraId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `cam-${timestamp}-${random}`;
}
/**
 * Gera totem_id baseado no cliente
 */ function generateTotemId(idCliente) {
  // Pega os primeiros 8 caracteres do UUID do cliente
  const clientPrefix = idCliente.substring(0, 8);
  return `totem-${clientPrefix}`;
}
/**
 * Gera nome do stream Kinesis
 */ function generateStreamName(totemId, cameraId) {
  return `visao-segura-${totemId}-${cameraId}`;
}
/**
 * Gera nome do bucket S3
 */ function generateBucketName(totemId) {
  return `visao-segura-${totemId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}
/**
 * Cria ou verifica bucket S3
 */ async function ensureS3Bucket(bucketName) {
  try {
    await s3Client.send(new HeadBucketCommand({
      Bucket: bucketName
    }));
    console.log(`✓ Bucket ${bucketName} já existe`);
    return {
      success: true,
      bucketName,
      existed: true
    };
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      // Criar bucket
      await s3Client.send(new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: AWS_REGION
        }
      }));
      // Configurar CORS
      await s3Client.send(new PutBucketCorsCommand({
        Bucket: bucketName,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: [
                "*"
              ],
              AllowedMethods: [
                "GET",
                "HEAD"
              ],
              AllowedOrigins: [
                "*"
              ],
              ExposeHeaders: [
                "ETag"
              ],
              MaxAgeSeconds: 3000
            }
          ]
        }
      }));
      console.log(`✓ Bucket ${bucketName} criado`);
      return {
        success: true,
        bucketName,
        created: true
      };
    }
    throw error;
  }
}
/**
 * Cria Kinesis Video Stream
 */ async function ensureKinesisStream(streamName) {
  try {
    const existing = await kinesisClient.send(new DescribeStreamCommand({
      StreamName: streamName
    }));
    console.log(`✓ Stream ${streamName} já existe`);
    return {
      success: true,
      streamName,
      streamARN: existing.StreamInfo?.StreamARN,
      existed: true
    };
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      const result = await kinesisClient.send(new CreateStreamCommand({
        StreamName: streamName,
        DataRetentionInHours: 24,
        MediaType: "video/h264"
      }));
      console.log(`✓ Stream ${streamName} criado`);
      return {
        success: true,
        streamName,
        streamARN: result.StreamARN,
        created: true
      };
    }
    throw error;
  }
}
/**
 * Gera URLs de streaming
 */ function generateStreamingUrls(streamName) {
  return {
    live_stream: `${STREAMING_BASE_URL}/${streamName}/`,
    stream_hls: `${STREAMING_BASE_URL}/${streamName}/playlist.m3u8`,
    rtmp: `rtmp://media.zeusvision.com.br:1935/${streamName}`
  };
}
// ============================================
// MAIN HANDLER
// ============================================
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return jsonResponse({}, 200);
  }
  if (req.method !== "POST") {
    return jsonResponse({
      success: false,
      message: "Only POST method is allowed"
    }, 405);
  }
  try {
    const supabase = buildSupabaseClient(req);
    const payload = await req.json();
    console.log("📥 Payload recebido:", payload);
    // ==========================================
    // 1. VALIDAÇÃO DOS DADOS DO FORMULÁRIO
    // ==========================================
    const { id_cliente, nome, descricao, plano, protocolo, rtsp_url, // Endereço (opcional)
    cep, endereco, numero, complemento, bairro, cidade, estado, latitude, longitude } = payload;
    // Validar campos obrigatórios
    if (!id_cliente) {
      return jsonResponse({
        success: false,
        message: "id_cliente é obrigatório"
      }, 400);
    }
    if (!nome) {
      return jsonResponse({
        success: false,
        message: "Nome da câmera é obrigatório"
      }, 400);
    }
    if (!rtsp_url) {
      return jsonResponse({
        success: false,
        message: "URL RTSP é obrigatória"
      }, 400);
    }
    // ==========================================
    // 2. EXTRAIR INFORMAÇÕES DA URL RTSP
    // ==========================================
    const rtspInfo = parseRtspUrl(rtsp_url);
    if (!rtspInfo) {
      return jsonResponse({
        success: false,
        message: "URL RTSP inválida. Formato esperado: rtsp://usuario:senha@ip:porta/caminho"
      }, 400);
    }
    console.log("🔗 RTSP parseado:", rtspInfo);
    // ==========================================
    // 3. GERAR IDs AUTOMATICAMENTE
    // ==========================================
    const cameraId = generateCameraId();
    const totemId = generateTotemId(id_cliente);
    const streamName = generateStreamName(totemId, cameraId);
    const bucketName = generateBucketName(totemId);
    console.log("🎲 IDs gerados:", {
      cameraId,
      totemId,
      streamName,
      bucketName
    });
    // ==========================================
    // 4. PROVISIONAR RECURSOS AWS
    // ==========================================
    console.log("☁️ Provisionando AWS...");
    let bucketResult, streamResult;
    try {
      // 4.1 - Bucket S3
      bucketResult = await ensureS3Bucket(bucketName);
      // 4.2 - Kinesis Stream
      streamResult = await ensureKinesisStream(streamName);
    } catch (awsError) {
      console.error("❌ Erro AWS:", awsError);
      return jsonResponse({
        success: false,
        message: "Erro ao provisionar recursos AWS",
        error: awsError.message
      }, 500);
    }
    // 4.3 - Gerar URLs
    const streamingUrls = generateStreamingUrls(streamName);
    console.log("✅ AWS provisionado com sucesso");
    // ==========================================
    // 5. PREPARAR DADOS PARA O BANCO
    // ==========================================
    const insertData = {
      // Identificação
      id_cliente,
      camera_id: cameraId,
      nome,
      descricao: descricao || null,
      // AWS/Kinesis
      totem_id: totemId,
      kinesis_stream_name: streamName,
      s3_bucket: bucketName,
      // Streaming URLs
      live_stream: streamingUrls.live_stream,
      stream_hls: streamingUrls.stream_hls,
      rtmp: streamingUrls.rtmp,
      // Conexão RTSP
      protocolo: protocolo || 'RTSP',
      rtsp_url: rtsp_url,
      ip_address: rtspInfo.hostname,
      porta: rtspInfo.port,
      usuario: rtspInfo.username,
      senha: rtspInfo.password,
      // Plano
      plano: plano || null,
      // Endereço
      cep: cep || null,
      endereco: endereco || null,
      numero: numero || null,
      complemento: complemento || null,
      bairro: bairro || null,
      cidade: cidade || null,
      estado: estado || null,
      latitude: latitude || null,
      longitude: longitude || null,
      // Status inicial
      status: 'offline',
      is_stream_alive: false,
      current_codec: 'H.264',
      current_resolution: 'N/A'
    };
    // ==========================================
    // 6. SALVAR NO BANCO DE DADOS
    // ==========================================
    console.log("💾 Salvando no banco...");
    const { data, error } = await supabase.from("cameras").insert(insertData).select(`
        *,
        cliente:cliente!id_cliente (
          id_cliente,
          nome,
          cpf,
          email
        )
      `).single();
    if (error) {
      console.error("❌ Erro ao salvar no banco:", error);
      return jsonResponse({
        success: false,
        error,
        message: "Erro ao salvar câmera no banco de dados"
      }, 500);
    }
    console.log("✅ Câmera salva no banco");
    // ==========================================
    // 7. RESPOSTA DE SUCESSO
    // ==========================================
    return jsonResponse({
      success: true,
      message: "Câmera criada e provisionada com sucesso! 🎉",
      data: {
        // Dados da câmera
        camera: {
          id: data.id,
          camera_id: data.camera_id,
          nome: data.nome,
          status: data.status,
          rtsp_url: data.rtsp_url,
          ip_address: data.ip_address,
          cliente: data.cliente
        },
        // Recursos AWS provisionados
        aws: {
          s3_bucket: {
            name: bucketName,
            status: bucketResult.existed ? "já existia" : "criado agora ✨",
            region: AWS_REGION,
            url: `https://s3.console.aws.amazon.com/s3/buckets/${bucketName}`
          },
          kinesis_stream: {
            name: streamName,
            arn: streamResult.streamARN,
            status: streamResult.existed ? "já existia" : "criado agora ✨",
            console_url: `https://${AWS_REGION}.console.aws.amazon.com/kinesisvideo/home?region=${AWS_REGION}#/streams/details/${streamName}/details`
          }
        },
        // URLs de streaming prontas
        streaming: {
          live_url: streamingUrls.live_stream,
          hls_url: streamingUrls.stream_hls,
          rtmp_url: streamingUrls.rtmp
        },
        // Próximos passos
        next_steps: [
          "1. Configure a câmera IP para enviar stream RTSP",
          "2. Ou use software (OBS/FFmpeg) para enviar para RTMP",
          "3. Aguarde alguns segundos para stream ficar disponível",
          "4. Use o player WebRTC para assistir ao vivo"
        ]
      }
    }, 201);
  } catch (error) {
    console.error("💥 Erro não tratado:", error);
    return jsonResponse({
      success: false,
      error: String(error),
      message: "Erro interno do servidor"
    }, 500);
  }
});
