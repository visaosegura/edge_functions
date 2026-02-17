import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
serve(async (req)=>{
  // Sempre retornar headers CORS, mesmo em caso de erro
  const createResponse = (body, status = 200)=>{
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  };
  try {
    console.log('🔵 [create-additional-user] Requisição recebida:', {
      method: req.method,
      url: req.url,
      hasAuthHeader: !!req.headers.get('Authorization')
    });
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      console.log('✅ [create-additional-user] Respondendo OPTIONS (CORS preflight)');
      return createResponse(null, 200);
    }
    try {
      // Obter token de autenticação
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      console.log('🔑 [create-additional-user] Auth header presente:', !!authHeader);
      if (!authHeader) {
        console.warn('⚠️ [create-additional-user] Token de autenticação não fornecido');
        return createResponse({
          success: false,
          error: 'Token de autenticação não fornecido'
        }, 401);
      }
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      // Verificar autenticação do usuário
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: getUserError } = await supabaseAdmin.auth.getUser(token);
      if (getUserError || !user) {
        console.error('❌ [create-additional-user] Erro ao obter usuário:', getUserError);
        return createResponse({
          success: false,
          error: 'Usuário não autenticado'
        }, 401);
      }
      console.log('✅ [create-additional-user] Usuário autenticado:', user.id);
      // Verificar se o usuário é cliente titular
      const { data: dadosUsuario, error: duError } = await supabaseAdmin.from('dados_usuario').select('id_dados, tipo_cliente').eq('auth_user_id', user.id).eq('tipo_cliente', 'cliente').single();
      if (duError || !dadosUsuario) {
        return createResponse({
          success: false,
          error: 'Usuário não é cliente titular'
        }, 403);
      }
      // Buscar cliente
      const { data: cliente, error: clienteError } = await supabaseAdmin.from('cliente').select('id_cliente').eq('id_dados', dadosUsuario.id_dados).single();
      if (clienteError || !cliente) {
        return createResponse({
          success: false,
          error: 'Cliente não encontrado'
        }, 404);
      }
      // Verificar se o cliente solicitado é o mesmo do usuário logado
      let dados;
      try {
        dados = await req.json();
      } catch (jsonError) {
        console.error('❌ Erro ao fazer parse do JSON:', jsonError);
        return createResponse({
          success: false,
          error: 'Erro ao processar dados da requisição.'
        }, 400);
      }
      if (dados.idCliente !== cliente.id_cliente) {
        return createResponse({
          success: false,
          error: 'Você não tem permissão para adicionar usuários a este cliente'
        }, 403);
      }
      console.log('📝 Dados recebidos:', {
        ...dados,
        senha: '[REDACTED]'
      });
      // Validar campos obrigatórios
      if (!dados.nome || !dados.email || !dados.senha) {
        return createResponse({
          success: false,
          error: 'Campos obrigatórios: nome, email e senha'
        }, 400);
      }
      // Verificar se e-mail já existe
      const { data: existingEmailUser, error: emailCheckError } = await supabaseAdmin.from('dados_usuario').select('id_dados').eq('email', dados.email.toLowerCase().trim()).maybeSingle();
      if (emailCheckError) {
        console.error('❌ Erro ao verificar e-mail:', emailCheckError);
        return createResponse({
          success: false,
          error: 'Erro ao verificar e-mail.'
        }, 500);
      }
      if (existingEmailUser) {
        console.log('⚠️ E-mail já cadastrado:', dados.email);
        return createResponse({
          success: false,
          error: 'E-mail já cadastrado.'
        }, 400);
      }
      // Verificar se já existe usuário adicional com este email
      const { data: existingAdditionalUser, error: additionalCheckError } = await supabaseAdmin.from('usuarios_adicionais').select('id').eq('email', dados.email.toLowerCase().trim()).maybeSingle();
      if (additionalCheckError) {
        console.error('❌ Erro ao verificar usuário adicional:', additionalCheckError);
        return createResponse({
          success: false,
          error: 'Erro ao verificar usuário adicional.'
        }, 500);
      }
      if (existingAdditionalUser) {
        console.log('⚠️ Usuário adicional já cadastrado com este e-mail:', dados.email);
        return createResponse({
          success: false,
          error: 'E-mail já cadastrado como usuário adicional.'
        }, 400);
      }
      // Verificar CPF se fornecido
      if (dados.cpf) {
        const cpfLimpo = dados.cpf.replace(/\D/g, '');
        const { data: existingCpfUser, error: cpfCheckError } = await supabaseAdmin.from('usuarios_adicionais').select('id').eq('cpf', cpfLimpo).maybeSingle();
        if (cpfCheckError) {
          console.error('❌ Erro ao verificar CPF:', cpfCheckError);
          return createResponse({
            success: false,
            error: 'Erro ao verificar CPF.'
          }, 500);
        }
        if (existingCpfUser) {
          console.log('⚠️ CPF já cadastrado:', cpfLimpo);
          return createResponse({
            success: false,
            error: 'CPF já cadastrado.'
          }, 400);
        }
      }
      // Criar usuário no Auth
      console.log('🔐 Criando usuário no Auth...');
      const { data: authUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: dados.email.toLowerCase().trim(),
        password: dados.senha,
        email_confirm: true,
        user_metadata: {
          nome: dados.nome,
          tipo_cliente: 'cliente_additional',
          id_cliente: dados.idCliente
        }
      });
      if (createUserError || !authUser.user) {
        console.error('❌ Erro ao criar usuário no Auth:', createUserError);
        return createResponse({
          success: false,
          error: createUserError?.message || 'Erro ao criar usuário.'
        }, 400);
      }
      console.log('✅ Usuário criado no Auth:', authUser.user.id);
      // Inserir usuário adicional na tabela
      const cpfLimpo = dados.cpf ? dados.cpf.replace(/\D/g, '') : null;
      const telefoneLimpo = dados.telefone ? dados.telefone.replace(/\D/g, '') : null;
      const { data: usuarioAdicional, error: insertError } = await supabaseAdmin.from('usuarios_adicionais').insert({
        id_cliente: dados.idCliente,
        auth_user_id: authUser.user.id,
        nome: dados.nome.trim(),
        email: dados.email.toLowerCase().trim(),
        cpf: cpfLimpo,
        telefone: telefoneLimpo,
        ativo: true
      }).select().single();
      if (insertError) {
        console.error('❌ Erro ao inserir usuário adicional:', insertError);
        // Tentar remover o usuário do Auth se a inserção falhar
        try {
          await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
        } catch (deleteError) {
          console.error('❌ Erro ao deletar usuário do Auth:', deleteError);
        }
        return createResponse({
          success: false,
          error: 'Erro ao cadastrar usuário adicional.'
        }, 500);
      }
      console.log('✅ Usuário adicional criado com sucesso:', usuarioAdicional.id);
      console.log('✅ Email já confirmado - usuário pode fazer login imediatamente');
      return createResponse({
        success: true,
        usuario: {
          id: usuarioAdicional.id,
          nome: usuarioAdicional.nome,
          email: usuarioAdicional.email,
          auth_user_id: usuarioAdicional.auth_user_id
        }
      }, 200);
    } catch (innerError) {
      console.error('❌ [create-additional-user] Erro interno:', innerError);
      return createResponse({
        success: false,
        error: innerError instanceof Error ? innerError.message : 'Erro interno do servidor.'
      }, 500);
    }
  } catch (error) {
    console.error('❌ [create-additional-user] Erro inesperado:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro interno do servidor.';
    console.error('❌ [create-additional-user] Stack:', error instanceof Error ? error.stack : 'N/A');
    return createResponse({
      success: false,
      error: errorMessage
    }, 500);
  }
});
