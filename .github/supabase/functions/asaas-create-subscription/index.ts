import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, validateAuth, validateClientAccess, validateRemoteIp, checkRateLimit, secureLog, errorResponse, maskSensitiveData } from './security.ts';
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // ✅ VALIDAÇÃO DE AUTENTICAÇÃO
    const user = await validateAuth(req, supabaseClient);
    const payload = await req.json();
    const { clienteId, planoId, billingType, nextDueDate, creditCard, creditCardHolderInfo, creditCardToken, remoteIp } = payload;
    // ✅ VALIDAÇÃO DE INPUT
    if (!clienteId || !planoId || !billingType || !nextDueDate) {
      throw new Error('Parâmetros obrigatórios ausentes');
    }
    if (![
      'PIX',
      'CREDIT_CARD'
    ].includes(billingType)) {
      throw new Error('Tipo de pagamento inválido');
    }
    // ✅ RATE LIMITING MAIS RESTRITIVO (3 tentativas por hora)
    if (!checkRateLimit(`create-subscription-${user.id}`, 3, 3600000)) {
      return new Response(JSON.stringify({
        error: 'Limite de tentativas excedido. Aguarde 1 hora.'
      }), {
        status: 429,
        headers: corsHeaders
      });
    }
    // ✅ VALIDAÇÃO DE AUTORIZAÇÃO
    const hasAccess = await validateClientAccess(supabaseClient, user.id, clienteId);
    if (!hasAccess) {
      secureLog(`[SECURITY] Tentativa não autorizada de criar assinatura: User ${user.id} -> Cliente ${clienteId}`);
      throw new Error('Acesso negado');
    }
    // ✅ VALIDAÇÃO CRÍTICA: remoteIp NÃO PODE SER IP DO SERVIDOR
    if (billingType === 'CREDIT_CARD') {
      if (!remoteIp) {
        throw new Error('remoteIp é obrigatório para pagamento com cartão');
      }
      if (!validateRemoteIp(remoteIp)) {
        secureLog(`[SECURITY] IP inválido ou interno detectado: ${remoteIp}`, {
          userId: user.id
        });
        throw new Error('IP do cliente inválido. Use o IP real do navegador do cliente.');
      }
      // ✅ VALIDAÇÃO: Dados do cartão OU token (nunca ambos em log)
      if (!creditCardToken && (!creditCard || !creditCardHolderInfo)) {
        throw new Error('Dados do cartão ou token são obrigatórios');
      }
      // ✅ NUNCA FAZER LOG DE DADOS DE CARTÃO
      secureLog('Criando assinatura com cartão', {
        clienteId,
        planoId,
        remoteIp,
        hasToken: !!creditCardToken,
        hasCard: !!creditCard
      });
    }
    // Buscar plano
    const { data: plano, error: planoError } = await supabaseClient.from('planos').select('*').eq('id', planoId).eq('status', 'ativo').single();
    if (planoError || !plano) {
      throw new Error('Plano não encontrado ou inativo');
    }
    // Verificar se já existe assinatura ativa para este cliente
    const { data: existingSubscription } = await supabaseClient.from('assinaturas').select('id, status').eq('id_cliente', clienteId).in('status', [
      'ACTIVE',
      'PENDING'
    ]).single();
    if (existingSubscription) {
      throw new Error('Cliente já possui assinatura ativa');
    }
    // Buscar/criar cliente no Asaas
    let { data: asaasCustomer } = await supabaseClient.from('asaas_customers').select('*').eq('id_cliente', clienteId).single();
    if (!asaasCustomer) {
      // Criar cliente no Asaas primeiro
      const createCustomerResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/asaas-create-customer`, {
        method: 'POST',
        headers: {
          'Authorization': req.headers.get('Authorization') ?? '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clienteId
        })
      });
      const customerResult = await createCustomerResponse.json();
      if (!customerResult.success) {
        throw new Error('Erro ao criar cliente no gateway de pagamento');
      }
      asaasCustomer = {
        asaas_customer_id: customerResult.asaas_customer_id
      };
    }
    // ✅ Configuração do Asaas (SANDBOX)
    const asaasApiKey = Deno.env.get('ASAAS_API_KEY');
    if (!asaasApiKey) {
      throw new Error('Configuração de API ausente');
    }
    // Preparar dados da assinatura
    const subscriptionData = {
      customer: asaasCustomer.asaas_customer_id,
      billingType,
      cycle: 'MONTHLY',
      value: plano.inclui_ia ? plano.valor_com_ia : plano.valor_base,
      nextDueDate,
      description: `Assinatura ${plano.nome} - ${plano.periodo_gravacao} dias de gravação`,
      externalReference: clienteId
    };
    // Adicionar dados do cartão se for CREDIT_CARD
    if (billingType === 'CREDIT_CARD') {
      if (creditCardToken) {
        subscriptionData.creditCardToken = creditCardToken;
        subscriptionData.remoteIp = remoteIp;
      } else if (creditCard && creditCardHolderInfo) {
        // ✅ SANITIZAR E VALIDAR DADOS DO CARTÃO
        subscriptionData.creditCard = {
          holderName: creditCard.holderName.trim().substring(0, 100),
          number: creditCard.number.replace(/\D/g, ''),
          expiryMonth: creditCard.expiryMonth.replace(/\D/g, ''),
          expiryYear: creditCard.expiryYear.replace(/\D/g, ''),
          ccv: creditCard.ccv.replace(/\D/g, '')
        };
        subscriptionData.creditCardHolderInfo = {
          name: creditCardHolderInfo.name.trim().substring(0, 100),
          email: creditCardHolderInfo.email.toLowerCase().trim(),
          cpfCnpj: creditCardHolderInfo.cpfCnpj.replace(/\D/g, ''),
          postalCode: creditCardHolderInfo.postalCode.replace(/\D/g, ''),
          addressNumber: creditCardHolderInfo.addressNumber.trim(),
          addressComplement: creditCardHolderInfo.addressComplement?.trim(),
          phone: creditCardHolderInfo.phone.replace(/\D/g, ''),
          mobilePhone: creditCardHolderInfo.mobilePhone?.replace(/\D/g, '')
        };
        subscriptionData.remoteIp = remoteIp;
      }
    }
    // ✅ LOG SEM DADOS SENSÍVEIS
    secureLog('Enviando requisição ao Asaas', {
      customer: asaasCustomer.asaas_customer_id,
      billingType,
      value: subscriptionData.value,
      hasCardData: billingType === 'CREDIT_CARD'
    });
    // ✅ TIMEOUT DE 60s CONFORME RECOMENDAÇÃO ASAAS
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(), 60000);
    try {
      const response = await fetch(`${ASAAS_API_URL}/subscriptions`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'access_token': asaasApiKey
        },
        body: JSON.stringify(subscriptionData),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const error = await response.json();
        secureLog('Erro ao criar assinatura no Asaas', {
          status: response.status,
          error: maskSensitiveData(error)
        });
        // Mensagens de erro mais amigáveis
        if (response.status === 400) {
          throw new Error('Dados do cartão inválidos ou recusados');
        } else if (response.status === 401) {
          throw new Error('Erro de autenticação com gateway de pagamento');
        }
        throw new Error('Erro ao processar pagamento. Verifique os dados e tente novamente.');
      }
      const asaasSubscription = await response.json();
      // Salvar assinatura no banco
      const { data: subscription, error: subError } = await supabaseClient.from('assinaturas').insert({
        id_cliente: clienteId,
        id_plano: planoId,
        asaas_subscription_id: asaasSubscription.id,
        asaas_customer_id: asaasCustomer.asaas_customer_id,
        billing_type: billingType,
        value: subscriptionData.value,
        next_due_date: nextDueDate,
        status: asaasSubscription.status,
        description: subscriptionData.description,
        activated_at: new Date().toISOString()
      }).select().single();
      if (subError) {
        // Tentar cancelar assinatura no Asaas se falhar no banco
        await fetch(`${ASAAS_API_URL}/subscriptions/${asaasSubscription.id}`, {
          method: 'DELETE',
          headers: {
            'accept': 'application/json',
            'access_token': asaasApiKey
          }
        }).catch(()=>{}) // Ignora erro de cancelamento
        ;
        throw new Error('Erro ao salvar assinatura');
      }
      // Atualizar plano do cliente
      await supabaseClient.from('cliente').update({
        id_plano: planoId
      }).eq('id_cliente', clienteId);
      secureLog('Assinatura criada com sucesso', {
        subscriptionId: subscription.id,
        clienteId,
        planoId
      });
      return new Response(JSON.stringify({
        success: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          value: subscription.value,
          next_due_date: subscription.next_due_date
        }
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Timeout ao processar pagamento. Tente novamente.');
      }
      throw fetchError;
    }
  } catch (error) {
    return errorResponse(error, error.message.includes('Acesso negado') ? 403 : 400);
  }
});
