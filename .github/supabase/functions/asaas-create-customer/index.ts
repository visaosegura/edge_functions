// supabase/functions/asaas-create-customer/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, ASAAS_API_URL, validateAuth, validateClientAccess, sanitizeString, validateCpfCnpj, validateEmail, validatePhone, checkRateLimit, secureLog, errorResponse, maskSensitiveData } from './security.ts';
serve(async (req)=>{
  const requestId = crypto.randomUUID();
  secureLog('🔷 Iniciando requisição', {
    requestId,
    method: req.method,
    url: req.url
  });
  // ✅ CORS Preflight
  if (req.method === 'OPTIONS') {
    secureLog('✅ CORS Preflight - Retornando OK', {
      requestId
    });
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  // ✅ Apenas POST permitido
  if (req.method !== 'POST') {
    secureLog('❌ Método não permitido', {
      requestId,
      method: req.method
    });
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }
  secureLog('✅ Método POST confirmado', {
    requestId
  });
  try {
    secureLog('🔧 Criando cliente Supabase', {
      requestId
    });
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // ✅ VALIDAÇÃO DE AUTENTICAÇÃO
    secureLog('🔐 Validando autenticação', {
      requestId
    });
    const user = await validateAuth(req, supabaseClient);
    secureLog('✅ Autenticação validada', {
      requestId,
      userId: user.id
    });
    secureLog('📥 Parseando payload', {
      requestId
    });
    const payload = await req.json();
    const { clienteId, forceUpdate, usarEnderecoCobrancaDiferente, enderecoCobranca } = payload;
    secureLog('📋 Payload recebido', {
      requestId,
      clienteId,
      forceUpdate,
      usarEnderecoCobrancaDiferente,
      hasEnderecoCobranca: !!enderecoCobranca
    });
    // ✅ VALIDAÇÃO DE INPUT
    secureLog('🔍 Validando clienteId', {
      requestId
    });
    if (!clienteId || typeof clienteId !== 'string') {
      secureLog('❌ clienteId inválido', {
        requestId,
        clienteId
      });
      throw new Error('clienteId inválido');
    }
    secureLog('✅ clienteId válido', {
      requestId
    });
    // ✅ RATE LIMITING
    secureLog('⏱️ Verificando rate limit', {
      requestId,
      userId: user.id
    });
    if (!checkRateLimit(`create-customer-${user.id}`, 10, 60000)) {
      secureLog('❌ Rate limit excedido', {
        requestId,
        userId: user.id
      });
      return new Response(JSON.stringify({
        error: 'Muitas requisições. Aguarde 1 minuto.'
      }), {
        status: 429,
        headers: corsHeaders
      });
    }
    secureLog('✅ Rate limit OK', {
      requestId
    });
    // ✅ VALIDAÇÃO DE AUTORIZAÇÃO
    secureLog('🛡️ Validando acesso ao cliente', {
      requestId,
      userId: user.id,
      clienteId
    });
    const hasAccess = await validateClientAccess(supabaseClient, user.id, clienteId);
    if (!hasAccess) {
      secureLog(`⛔ Acesso não autorizado: User ${user.id} -> Cliente ${clienteId}`, {
        requestId
      });
      throw new Error('Acesso negado');
    }
    secureLog('✅ Acesso autorizado', {
      requestId
    });
    // Buscar dados do cliente
    secureLog('🔍 Buscando dados do cliente', {
      requestId,
      clienteId
    });
    const { data: cliente, error: clienteError } = await supabaseClient.from('cliente').select(`
        *,
        dados_usuario!inner(
          *,
          endereco:id_endereco(*),
          contato:id_contato(*)
        )
      `).eq('id_cliente', clienteId).single();
    if (clienteError) {
      secureLog('❌ Erro ao buscar cliente', {
        requestId,
        error: clienteError
      });
      throw new Error('Cliente não encontrado');
    }
    if (!cliente) {
      secureLog('❌ Cliente não encontrado', {
        requestId,
        clienteId
      });
      throw new Error('Cliente não encontrado');
    }
    secureLog('✅ Cliente encontrado', {
      requestId,
      clienteId,
      hasEndereco: !!cliente.dados_usuario?.endereco,
      hasContato: !!cliente.dados_usuario?.contato
    });
    // ✅ VALIDAÇÃO DE DADOS
    const dadosUsuario = cliente.dados_usuario;
    secureLog('🔍 Validando CPF/CNPJ', {
      requestId
    });
    if (!validateCpfCnpj(dadosUsuario.cpf_cnpj)) {
      secureLog('❌ CPF/CNPJ inválido', {
        requestId
      });
      throw new Error('CPF/CNPJ inválido');
    }
    secureLog('✅ CPF/CNPJ válido', {
      requestId
    });
    secureLog('🔍 Validando Email', {
      requestId
    });
    if (!validateEmail(dadosUsuario.email)) {
      secureLog('❌ Email inválido', {
        requestId
      });
      throw new Error('Email inválido');
    }
    secureLog('✅ Email válido', {
      requestId
    });
    const contato = dadosUsuario.contato;
    if (contato?.telefone) {
      secureLog('🔍 Validando telefone', {
        requestId
      });
      if (!validatePhone(contato.telefone)) {
        secureLog('❌ Telefone inválido', {
          requestId
        });
        throw new Error('Telefone inválido');
      }
      secureLog('✅ Telefone válido', {
        requestId
      });
    }
    if (contato?.celular) {
      secureLog('🔍 Validando celular', {
        requestId
      });
      if (!validatePhone(contato.celular)) {
        secureLog('❌ Celular inválido', {
          requestId
        });
        throw new Error('Celular inválido');
      }
      secureLog('✅ Celular válido', {
        requestId
      });
    }
    // Verificar se já existe no Asaas
    secureLog('🔍 Verificando se cliente já existe no Asaas', {
      requestId,
      clienteId
    });
    const { data: existingAsaas, error: asaasCheckError } = await supabaseClient.from('asaas_customers').select('*').eq('id_cliente', clienteId).single();
    if (asaasCheckError && asaasCheckError.code !== 'PGRST116') {
      secureLog('⚠️ Erro ao verificar cliente no Asaas', {
        requestId,
        error: asaasCheckError
      });
    }
    if (existingAsaas) {
      secureLog('ℹ️ Cliente já existe no Asaas', {
        requestId,
        asaasCustomerId: existingAsaas.asaas_customer_id,
        forceUpdate
      });
      if (!forceUpdate) {
        secureLog('✅ Retornando cliente existente', {
          requestId
        });
        return new Response(JSON.stringify({
          success: true,
          exists: true,
          asaas_customer_id: existingAsaas.asaas_customer_id
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      secureLog('🔄 forceUpdate ativo - Cliente será atualizado', {
        requestId
      });
    } else {
      secureLog('ℹ️ Cliente não existe - Será criado', {
        requestId
      });
    }
    // Configuração do Asaas
    secureLog('🔧 Configurando Asaas', {
      requestId
    });
    const asaasApiKey = Deno.env.get('ASAAS_API_KEY');
    if (!asaasApiKey) {
      secureLog('❌ API Key do Asaas não configurada', {
        requestId
      });
      throw new Error('Configuração de API Asaas ausente');
    }
    secureLog('✅ Asaas configurado', {
      requestId,
      url: ASAAS_API_URL
    });
    // Determinar endereço
    let enderecoParaUsar = cliente.dados_usuario.endereco;
    let idEnderecoCobranca = null;
    if (usarEnderecoCobrancaDiferente && enderecoCobranca) {
      secureLog('🏠 Processando endereço de cobrança diferente', {
        requestId
      });
      if (!enderecoCobranca.cep || !enderecoCobranca.rua || !enderecoCobranca.numero) {
        secureLog('❌ Endereço de cobrança incompleto', {
          requestId
        });
        throw new Error('Endereço de cobrança incompleto');
      }
      secureLog('✅ Endereço de cobrança validado', {
        requestId
      });
      secureLog('💾 Salvando endereço de cobrança', {
        requestId
      });
      const { data: novoEndereco, error: enderecoError } = await supabaseClient.from('endereco').insert({
        cep: sanitizeString(enderecoCobranca.cep).replace(/\D/g, ''),
        rua: sanitizeString(enderecoCobranca.rua),
        numero: sanitizeString(enderecoCobranca.numero),
        complemento: sanitizeString(enderecoCobranca.complemento),
        bairro: sanitizeString(enderecoCobranca.bairro),
        cidade: sanitizeString(enderecoCobranca.cidade),
        estado: sanitizeString(enderecoCobranca.estado).toUpperCase().substring(0, 2)
      }).select().single();
      if (enderecoError) {
        secureLog('❌ Erro ao salvar endereço', {
          requestId,
          error: enderecoError
        });
        throw new Error('Erro ao salvar endereço de cobrança');
      }
      enderecoParaUsar = novoEndereco;
      idEnderecoCobranca = novoEndereco.id_endereco;
      secureLog('✅ Endereço de cobrança salvo', {
        requestId,
        idEnderecoCobranca
      });
    } else {
      secureLog('🏠 Usando endereço padrão', {
        requestId
      });
    }
    // Preparar dados para Asaas
    secureLog('🧹 Sanitizando dados', {
      requestId
    });
    const asaasData = {
      name: sanitizeString(dadosUsuario.razao_nome),
      cpfCnpj: dadosUsuario.cpf_cnpj?.replace(/\D/g, ''),
      email: dadosUsuario.email.toLowerCase().trim(),
      phone: contato?.telefone?.replace(/\D/g, ''),
      mobilePhone: contato?.celular?.replace(/\D/g, ''),
      address: sanitizeString(enderecoParaUsar?.rua),
      addressNumber: sanitizeString(enderecoParaUsar?.numero),
      complement: sanitizeString(enderecoParaUsar?.complemento),
      province: sanitizeString(enderecoParaUsar?.bairro),
      postalCode: enderecoParaUsar?.cep?.replace(/\D/g, ''),
      externalReference: clienteId,
      notificationDisabled: false
    };
    secureLog('📤 Dados preparados', {
      requestId,
      data: maskSensitiveData(asaasData)
    });
    let asaasCustomerId = existingAsaas?.asaas_customer_id;
    if (existingAsaas && forceUpdate) {
      secureLog('🔄 Atualizando no Asaas', {
        requestId,
        asaasCustomerId
      });
      const response = await fetch(`${ASAAS_API_URL}/customers/${asaasCustomerId}`, {
        method: 'PUT',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'access_token': asaasApiKey
        },
        body: JSON.stringify(asaasData)
      });
      secureLog('📡 Resposta Asaas (UPDATE)', {
        requestId,
        status: response.status,
        ok: response.ok
      });
      if (!response.ok) {
        const error = await response.json();
        secureLog('❌ Erro ao atualizar no Asaas', {
          requestId,
          status: response.status,
          error
        });
        throw new Error('Erro ao atualizar cliente no gateway');
      }
      secureLog('✅ Cliente atualizado no Asaas', {
        requestId
      });
      secureLog('💾 Atualizando registro local', {
        requestId
      });
      const { error: updateError } = await supabaseClient.from('asaas_customers').update({
        usa_endereco_cobranca_diferente: usarEnderecoCobrancaDiferente,
        id_endereco_cobranca: idEnderecoCobranca,
        synced_at: new Date().toISOString()
      }).eq('id_cliente', clienteId);
      if (updateError) {
        secureLog('⚠️ Erro ao atualizar local', {
          requestId,
          error: updateError
        });
      } else {
        secureLog('✅ Registro local atualizado', {
          requestId
        });
      }
    } else {
      secureLog('🆕 Criando no Asaas', {
        requestId
      });
      const response = await fetch(`${ASAAS_API_URL}/customers`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'access_token': asaasApiKey
        },
        body: JSON.stringify(asaasData)
      });
      secureLog('📡 Resposta Asaas (CREATE)', {
        requestId,
        status: response.status,
        ok: response.ok
      });
      if (!response.ok) {
        const error = await response.json();
        secureLog('❌ Erro ao criar no Asaas', {
          requestId,
          status: response.status,
          error
        });
        throw new Error('Erro ao criar cliente no gateway');
      }
      const result = await response.json();
      asaasCustomerId = result.id;
      secureLog('✅ Cliente criado no Asaas', {
        requestId,
        asaasCustomerId
      });
      secureLog('💾 Salvando no banco', {
        requestId
      });
      const { error: insertError } = await supabaseClient.from('asaas_customers').upsert({
        id_cliente: clienteId,
        asaas_customer_id: asaasCustomerId,
        asaas_external_reference: clienteId,
        usa_endereco_cobranca_diferente: usarEnderecoCobrancaDiferente,
        id_endereco_cobranca: idEnderecoCobranca,
        synced_at: new Date().toISOString()
      });
      if (insertError) {
        secureLog('⚠️ Erro ao salvar no banco', {
          requestId,
          error: insertError
        });
      } else {
        secureLog('✅ Registro salvo no banco', {
          requestId
        });
      }
    }
    secureLog('🎉 Operação concluída', {
      requestId,
      clienteId,
      asaasCustomerId
    });
    return new Response(JSON.stringify({
      success: true,
      asaas_customer_id: asaasCustomerId
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    secureLog('💥 Erro', {
      requestId,
      message: error.message,
      stack: error.stack
    });
    return errorResponse(error, error.message.includes('Acesso negado') ? 403 : 400);
  }
});
