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
    console.log('=== INICIANDO CADASTRO DE ADMIN ===');
    console.log('📧 Email:', dados.email);
    if (!dados.senha || dados.senha.length < 8) {
      throw new Error('Senha deve ter no mínimo 8 caracteres');
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
    // PASSO 3: Criar usuário via signUp com emailRedirectTo
    console.log('📝 Criando usuário via signUp...');
    const { data: signUpData, error: signUpError } = await supabaseAdmin.auth.signUp({
      email: dados.email.toLowerCase().trim(),
      password: dados.senha,
      options: {
        data: {
          razao_nome: dados.razaoSocial.trim(),
          cpf_cnpj: dados.cnpj.replace(/\D/g, ''),
          tipo_pessoa: 'juridica',
          tipo_cliente: 'admin',
          id_contato: contato.id_contato,
          id_endereco: endereco.id_endereco,
          area_atuacao: dados.areaAtuacao
        },
        emailRedirectTo: `${Deno.env.get('SITE_URL') || 'http://localhost:5173'}/auth/callback`
      }
    });
    if (signUpError) {
      console.error('❌ Erro ao criar usuário:', signUpError);
      // Rollback
      await supabaseAdmin.from('contato').delete().eq('id_contato', contato.id_contato);
      await supabaseAdmin.from('endereco').delete().eq('id_endereco', endereco.id_endereco);
      if (signUpError.message.includes('already registered')) {
        throw new Error('Este email já está cadastrado');
      }
      throw new Error(signUpError.message);
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
