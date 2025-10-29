import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
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
    console.log('=== INICIANDO CADASTRON DE ADMIN ===');
    console.log('📧 Email:', dados.email);
    if (!dados.senha) {
      throw new Error('Senha é obrigatória para criar a conta');
    }
    // PASSO 1: Criar CONTATO
    console.log('📝 Criando contato...');
    const { data: contato, error: contatoError } = await supabaseAdmin.from('contato').insert({
      email: dados.email.toLowerCase().trim(),
      celular: dados.celular.replace(/\D/g, ''),
      telefone: dados.telefone ? dados.telefone.replace(/\D/g, '') : null,
      redes_sociais: dados.redesSociais || []
    }).select('id_contato').single();
    if (contatoError) {
      console.error('❌ Erro ao criar contato:', contatoError);
      throw new Error(`Erro ao salvar contato: ${contatoError.message}`);
    }
    console.log('✅ Contato criado:', contato.id_contato);
    // PASSO 2: Criar ENDERECO
    console.log('📝 Criando endereço...');
    const { data: endereco, error: enderecoError } = await supabaseAdmin.from('endereco').insert({
      cep: dados.cep.replace(/\D/g, ''),
      rua: dados.rua.trim(),
      numero: dados.numero.trim(),
      complemento: dados.complemento?.trim() || null,
      bairro: dados.bairro.trim(),
      cidade: dados.cidade.trim(),
      estado: dados.estado.toUpperCase()
    }).select('id_endereco').single();
    if (enderecoError) {
      console.error('❌ Erro ao criar endereço:', enderecoError);
      await supabaseAdmin.from('contato').delete().eq('id_contato', contato.id_contato);
      throw new Error(`Erro ao salvar endereço: ${enderecoError.message}`);
    }
    console.log('✅ Endereço criado:', endereco.id_endereco);
    // PASSO 3: Criar usuário via signUp
    console.log('📝 Criando usuário via signUp...');
    // ✅ CORREÇÃO: Não passar options no body do signUp
    // O redirect_to será configurado no Supabase Dashboard
    const signUpResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: dados.email.toLowerCase().trim(),
        password: dados.senha,
        data: {
          razao_nome: dados.razaoSocial.trim(),
          cpf_cnpj: dados.cnpj.replace(/\D/g, ''),
          tipo_pessoa: 'juridica',
          tipo_cliente: 'admin',
          id_contato: contato.id_contato,
          id_endereco: endereco.id_endereco
        }
      })
    });
    const signUpData = await signUpResponse.json();
    if (!signUpResponse.ok) {
      console.error('❌ Erro ao criar usuário:', signUpData);
      // Rollback
      await supabaseAdmin.from('contato').delete().eq('id_contato', contato.id_contato);
      await supabaseAdmin.from('endereco').delete().eq('id_endereco', endereco.id_endereco);
      if (signUpData.msg?.includes('already registered') || signUpData.error_description?.includes('already registered')) {
        throw new Error('Este email já está cadastrado');
      }
      throw new Error(signUpData.msg || signUpData.error_description || 'Erro ao criar conta');
    }
    console.log('✅ Usuário criado:', signUpData.user?.id);
    console.log('✅ Email de confirmação enviado');
    console.log('=== CADASTRO CONCLUÍDO ===');
    return new Response(JSON.stringify({
      success: true,
      needsConfirmation: true,
      email: dados.email,
      userId: signUpData.user?.id,
      message: 'Cadastro realizado com sucesso! Verifique seu email para confirmar a conta.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('💥 ERRO NO CADASTRO:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Erro interno do servidor',
      success: false
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
