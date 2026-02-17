// security.ts (copiar este arquivo em cada pasta de Edge Function)
// ============================================
// CONFIGURAÇÕES
// ============================================
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS'
};
export const ASAAS_API_URL = Deno.env.get('ASAAS_ENVIRONMENT') === 'production' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3';
// ============================================
// AUTENTICAÇÃO
// ============================================
export async function validateAuth(req, supabaseClient) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Token de autenticação ausente');
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabaseClient.auth.getUser(token);
  if (error || !user) {
    throw new Error('Token inválido ou expirado');
  }
  return user;
}
// ============================================
// AUTORIZAÇÃO (IDOR PROTECTION)
// ============================================
export async function validateClientAccess(supabaseClient, userId, clienteId) {
  const { data: dadosUsuario } = await supabaseClient.from('dados_usuario').select('id_dados').eq('auth_user_id', userId).single();
  if (!dadosUsuario) {
    return false;
  }
  const { data, error } = await supabaseClient.from('cliente').select('id_cliente').eq('id_cliente', clienteId).eq('id_admin', dadosUsuario.id_dados).single();
  return !error && !!data;
}
export async function validateAssinaturaAccess(supabaseClient, userId, assinaturaId) {
  const { data: dadosUsuario } = await supabaseClient.from('dados_usuario').select('id_dados').eq('auth_user_id', userId).single();
  if (!dadosUsuario) {
    return false;
  }
  const { data, error } = await supabaseClient.from('assinaturas').select(`
      id_assinatura,
      cliente!inner(
        id_admin
      )
    `).eq('id_assinatura', assinaturaId).eq('cliente.id_admin', dadosUsuario.id_dados).single();
  return !error && !!data;
}
export async function requireAdmin(supabaseClient, userId) {
  const { data: dadosUsuario } = await supabaseClient.from('dados_usuario').select('tipo_cliente').eq('auth_user_id', userId).single();
  if (!dadosUsuario || dadosUsuario.tipo_cliente !== 'admin') {
    throw new Error('Acesso negado - Apenas administradores');
  }
}
// ============================================
// SANITIZAÇÃO
// ============================================
export function sanitizeString(str) {
  if (!str) return '';
  return str.toString().trim().replace(/[<>]/g, '').substring(0, 500);
}
// ============================================
// VALIDAÇÕES
// ============================================
export function validateCpfCnpj(cpfCnpj) {
  if (!cpfCnpj) return false;
  const cleaned = cpfCnpj.replace(/\D/g, '');
  if (cleaned.length !== 11 && cleaned.length !== 14) {
    return false;
  }
  if (/^(\d)\1+$/.test(cleaned)) {
    return false;
  }
  if (cleaned.length === 11) {
    return validateCPF(cleaned);
  } else {
    return validateCNPJ(cleaned);
  }
}
function validateCPF(cpf) {
  let sum = 0;
  let remainder;
  for(let i = 1; i <= 9; i++){
    sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  }
  remainder = sum * 10 % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cpf.substring(9, 10))) return false;
  sum = 0;
  for(let i = 1; i <= 10; i++){
    sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  }
  remainder = sum * 10 % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cpf.substring(10, 11))) return false;
  return true;
}
function validateCNPJ(cnpj) {
  let length = cnpj.length - 2;
  let numbers = cnpj.substring(0, length);
  const digits = cnpj.substring(length);
  let sum = 0;
  let pos = length - 7;
  for(let i = length; i >= 1; i--){
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
  if (result !== parseInt(digits.charAt(0))) return false;
  length = length + 1;
  numbers = cnpj.substring(0, length);
  sum = 0;
  pos = length - 7;
  for(let i = length; i >= 1; i--){
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - sum % 11;
  if (result !== parseInt(digits.charAt(1))) return false;
  return true;
}
export function validateEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}
export function validatePhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 11;
}
export function validateRemoteIp(ip) {
  if (!ip) return false;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return false;
  }
  const parts = ip.split('.');
  const isValid = parts.every((part)=>{
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
  if (!isValid) {
    return false;
  }
  const firstOctet = parseInt(parts[0], 10);
  const secondOctet = parseInt(parts[1], 10);
  if (firstOctet === 10 || firstOctet === 127 || firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31 || firstOctet === 192 && secondOctet === 168) {
    return false;
  }
  return true;
}
// ============================================
// RATE LIMITING
// ============================================
const rateLimitStore = new Map();
export function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return true;
  }
  if (record.count >= maxRequests) {
    return false;
  }
  record.count++;
  return true;
}
setInterval(()=>{
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()){
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
// ============================================
// LOGGING
// ============================================
export function secureLog(message, data) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}
export function maskSensitiveData(data) {
  if (!data) return data;
  const masked = {
    ...data
  };
  const sensitiveFields = [
    'cpfCnpj',
    'cpf_cnpj',
    'email',
    'phone',
    'mobilePhone',
    'creditCard',
    'ccv',
    'number',
    'token',
    'password',
    'postalCode',
    'address',
    'addressNumber'
  ];
  for (const field of sensitiveFields){
    if (masked[field]) {
      if (typeof masked[field] === 'string') {
        const value = masked[field];
        if (value.length > 4) {
          masked[field] = value.substring(0, 3) + '***' + value.substring(value.length - 2);
        } else {
          masked[field] = '***';
        }
      } else if (typeof masked[field] === 'object') {
        masked[field] = '***REDACTED***';
      }
    }
  }
  return masked;
}
// ============================================
// RESPOSTAS DE ERRO
// ============================================
export function errorResponse(error, statusCode = 400) {
  const message = error?.message || 'Erro desconhecido';
  secureLog('Erro na requisição', {
    message,
    statusCode,
    stack: error?.stack?.substring(0, 500)
  });
  return new Response(JSON.stringify({
    error: message,
    success: false
  }), {
    status: statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
