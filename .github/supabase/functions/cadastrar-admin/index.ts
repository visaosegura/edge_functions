import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const dados = await req.json();
    console.log('📝 Dados recebidos:', {
      ...dados,
      senha: '[REDACTED]'
    });
    // Validar campos obrigatórios
    const camposObrigatorios = {
      razaoSocial: dados.razaoSocial,
      cnpj: dados.cnpj,
      email: dados.email,
      senha: dados.senha,
      celular: dados.celular,
      rua: dados.rua,
      numero: dados.numero,
      bairro: dados.bairro,
      cidade: dados.cidade,
      estado: dados.estado
    };
    for (const [campo, valor] of Object.entries(camposObrigatorios)){
      if (!valor || typeof valor === 'string' && valor.trim() === '') {
        console.error(`❌ Campo obrigatório ausente: ${campo}`);
        return new Response(JSON.stringify({
          success: false,
          error: `Campo obrigatório ausente: ${campo}`
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Verificar se e-mail já existe
    const { data: existingEmailUser, error: emailCheckError } = await supabaseAdmin.from('dados_usuario').select('id_dados').eq('email', dados.email).maybeSingle();
    if (emailCheckError) {
      console.error('❌ Erro ao verificar e-mail:', emailCheckError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Erro ao verificar e-mail.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (existingEmailUser) {
      console.log('⚠️ E-mail já cadastrado:', dados.email);
      return new Response(JSON.stringify({
        success: false,
        error: 'E-mail já cadastrado.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Verificar se CNPJ já existe
    const cnpjLimpo = dados.cnpj.replace(/\D/g, '');
    const { data: existingCnpjUser, error: cnpjCheckError } = await supabaseAdmin.from('dados_usuario').select('id_dados').eq('cpf_cnpj', cnpjLimpo).maybeSingle();
    if (cnpjCheckError) {
      console.error('❌ Erro ao verificar CNPJ:', cnpjCheckError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Erro ao verificar CNPJ.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (existingCnpjUser) {
      console.log('⚠️ CNPJ já cadastrado:', cnpjLimpo);
      return new Response(JSON.stringify({
        success: false,
        error: 'CNPJ já cadastrado.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Criar usuário no Auth
    console.log('🔐 Criando usuário no Auth...');
    const redirectUrl = `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify`;
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: dados.email,
      password: dados.senha,
      email_confirm: false,
      user_metadata: {
        razao_social: dados.razaoSocial,
        cnpj: cnpjLimpo,
        tipo_cliente: 'admin'
      }
    });
    console.log('📧 Email de confirmação deve ser enviado para:', dados.email);
    if (authError || !authUser.user) {
      console.error('❌ Erro ao criar usuário no Auth:', authError);
      return new Response(JSON.stringify({
        success: false,
        error: authError?.message || 'Erro ao criar usuário.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Usuário criado no Auth:', authUser.user.id);
    try {
      // Inserir contato
      console.log('📞 Inserindo contato...');
      const { data: contato, error: contatoError } = await supabaseAdmin.from('contato').insert({
        email: dados.email,
        celular: dados.celular,
        telefone: dados.telefone || null,
        redes_sociais: dados.redesSociais || []
      }).select().single();
      if (contatoError) throw contatoError;
      console.log('✅ Contato inserido:', contato.id_contato);
      // Inserir endereço (CEP é opcional)
      console.log('🏠 Inserindo endereço...');
      const cepLimpo = dados.cep ? dados.cep.replace(/\D/g, '') : '';
      const { data: endereco, error: enderecoError } = await supabaseAdmin.from('endereco').insert({
        cep: cepLimpo || '00000000',
        rua: dados.rua,
        numero: dados.numero,
        complemento: dados.complemento || null,
        bairro: dados.bairro,
        cidade: dados.cidade,
        estado: dados.estado
      }).select().single();
      if (enderecoError) throw enderecoError;
      console.log('✅ Endereço inserido:', endereco.id_endereco);
      // Inserir dados_usuario
      console.log('👤 Inserindo dados_usuario...');
      const { data: dadosUsuario, error: dadosError } = await supabaseAdmin.from('dados_usuario').insert({
        auth_user_id: authUser.user.id,
        razao_nome: dados.razaoSocial,
        cpf_cnpj: cnpjLimpo,
        usuario: dados.email.split('@')[0],
        tipo_pessoa: 'juridica',
        tipo_cliente: 'admin',
        email: dados.email,
        id_contato: contato.id_contato,
        id_endereco: endereco.id_endereco,
        first_login: true
      }).select().single();
      if (dadosError) throw dadosError;
      console.log('✅ dados_usuario inserido:', dadosUsuario.id_dados);
      // Inserir admin
      console.log('👑 Inserindo admin...');
      const { data: admin, error: adminError } = await supabaseAdmin.from('admin').insert({
        id_dados: dadosUsuario.id_dados
      }).select().single();
      if (adminError) throw adminError;
      console.log('✅ Admin inserido:', admin.id);
      console.log('🎉 Cadastro completo com sucesso!');
      return new Response(JSON.stringify({
        success: true,
        userId: authUser.user.id,
        message: 'Cadastro realizado com sucesso! Verifique seu e-mail para confirmar.'
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (dbError) {
      console.error('❌ Erro ao inserir dados no banco:', dbError);
      // Rollback: deletar usuário do Auth
      console.log('🔄 Rollback: deletando usuário do Auth...');
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return new Response(JSON.stringify({
        success: false,
        error: `Erro ao salvar dados: ${dbError instanceof Error ? dbError.message : 'Erro desconhecido'}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('💥 Erro geral:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
