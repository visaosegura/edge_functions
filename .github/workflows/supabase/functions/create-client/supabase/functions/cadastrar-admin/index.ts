import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  try {
    const dados = await req.json();
    const email = dados.email.toLowerCase().trim();
    const senha = dados.senha?.trim();
    const cnpj = dados.cnpj.replace(/\D/g, '');
    if (!senha || senha.length < 8) throw new Error('Senha deve ter no mínimo 8 caracteres');
    // === 1. Verificações paralelas (CNPJ + e-mail duplicado) ===
    const [cnpjRes, emailRes] = await Promise.all([
      supabaseAdmin.from('dados_usuario').select('id_dados, auth_user_id').eq('cpf_cnpj', cnpj).maybeSingle(),
      supabaseAdmin.from('dados_usuario').select('id_dados, auth_user_id').eq('email', email).maybeSingle()
    ]);
    if (cnpjRes.data?.auth_user_id) throw new Error('CNPJ já cadastrado.');
    if (emailRes.data?.auth_user_id) throw new Error('E-mail já cadastrado.');
    // === 2. Criar auth.user direto ===
    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password: senha
    });
    if (authError) throw new Error(authError.message);
    const authUserId = authData.user.id;
    // === 3. Inserções em paralelo ===
    const contatoPromise = supabaseAdmin.from('contato').insert({
      email,
      celular: dados.celular?.replace(/\D/g, ''),
      telefone: dados.telefone?.replace(/\D/g, '') || null,
      redes_sociais: dados.redesSociais || []
    }).select('id_contato').single();
    const enderecoPromise = supabaseAdmin.from('endereco').insert({
      cep: dados.cep?.replace(/\D/g, ''),
      rua: dados.rua.trim(),
      numero: dados.numero.trim(),
      complemento: dados.complemento?.trim() || null,
      bairro: dados.bairro.trim(),
      cidade: dados.cidade.trim(),
      estado: dados.estado.toUpperCase()
    }).select('id_endereco').single();
    const [{ data: contato }, { data: endereco }] = await Promise.all([
      contatoPromise,
      enderecoPromise
    ]);
    // === 4. Inserir dados_usuario e admin ===
    const { data: dadosUsuario, error: dadosError } = await supabaseAdmin.from('dados_usuario').insert({
      auth_user_id: authUserId,
      razao_nome: dados.razaoSocial.trim(),
      cpf_cnpj: cnpj,
      usuario: email.split('@')[0],
      email,
      tipo_pessoa: 'juridica',
      tipo_cliente: 'admin',
      id_contato: contato.id_contato,
      id_endereco: endereco.id_endereco,
      first_login: true
    }).select('id_dados').single();
    if (dadosError) throw new Error(dadosError.message);
    const { data: admin, error: adminError } = await supabaseAdmin.from('admin').insert({
      id_dados: dadosUsuario.id_dados
    }).select('id').single();
    if (adminError) throw new Error(adminError.message);
    // === 5. Atualizar metadata ===
    await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      user_metadata: {
        tipo_cliente: 'admin',
        razao_nome: dados.razaoSocial,
        cpf_cnpj: cnpj,
        id_contato: contato.id_contato,
        id_endereco: endereco.id_endereco,
        id_dados: dadosUsuario.id_dados,
        id_admin: admin.id,
        area_atuacao: dados.areaAtuacao
      }
    });
    return new Response(JSON.stringify({
      success: true,
      message: 'Cadastro realizado com sucesso!',
      data: {
        userId: authUserId,
        adminId: admin.id,
        dadosUsuarioId: dadosUsuario.id_dados,
        email
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (err) {
    console.error('Erro:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
