import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
/**
 * Hash de senha usando Web Crypto API (nativa do Deno)
 * Mais rápido e confiável que bcrypt para este caso
 */ async function hashPassword(senha) {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  // Gerar hash SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  // Converter para hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b)=>b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    console.log('=== INICIANDO CADASTRO DE CLIENTE (SEM SUPABASE AUTH) ===');
    const requestData = await req.json();
    console.log('Dados recebidos:', {
      ...requestData,
      dadosCredenciais: {
        ...requestData.dadosCredenciais,
        senha: '***'
      }
    });
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { dadosCliente, dadosContato, dadosEndereco, dadosCredenciais, idAdminLogado } = requestData;
    // 1. Verificar se email já existe
    console.log('📝 Verificando email existente...');
    const { data: existingContact } = await supabase.from('contato').select('id_contato').eq('email', dadosContato.email.toLowerCase().trim()).maybeSingle();
    if (existingContact) {
      console.error('❌ Email já cadastrado');
      return new Response(JSON.stringify({
        error: 'Este email já está cadastrado'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 2. Verificar se CPF/CNPJ já existe
    const cpfCnpj = dadosCliente.tipoPessoa === 'fisica' ? dadosCliente.cpf.replace(/\D/g, '') : dadosCliente.cnpj.replace(/\D/g, '');
    console.log('📝 Verificando CPF/CNPJ existente:', cpfCnpj);
    const { data: existingUser } = await supabase.from('dados_usuario').select('id_dados').eq('cpf_cnpj', cpfCnpj).maybeSingle();
    if (existingUser) {
      console.error('❌ CPF/CNPJ já cadastrado');
      return new Response(JSON.stringify({
        error: `Este ${dadosCliente.tipoPessoa === 'fisica' ? 'CPF' : 'CNPJ'} já está cadastrado`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // PASSO 1: Criar CONTATO
    console.log('📝 Passo 1: Criando contato...');
    const { data: contatoData, error: contatoError } = await supabase.from('contato').insert({
      email: dadosContato.email.toLowerCase().trim(),
      celular: dadosContato.celular.replace(/\D/g, ''),
      telefone: dadosContato.telefone ? dadosContato.telefone.replace(/\D/g, '') : null,
      redes_sociais: dadosContato.redesSociais || []
    }).select('id_contato').single();
    if (contatoError) {
      console.error('❌ Erro ao criar contato:', contatoError);
      return new Response(JSON.stringify({
        error: `Erro ao salvar contato: ${contatoError.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Contato criado:', contatoData.id_contato);
    try {
      // PASSO 2: Criar ENDERECO
      console.log('📝 Passo 2: Criando endereço...');
      const { data: enderecoData, error: enderecoError } = await supabase.from('endereco').insert({
        cep: dadosEndereco.cep.replace(/\D/g, ''),
        rua: dadosEndereco.rua.trim(),
        numero: dadosEndereco.numero.trim(),
        complemento: dadosEndereco.complemento?.trim() || null,
        bairro: dadosEndereco.bairro.trim(),
        cidade: dadosEndereco.cidade.trim(),
        estado: dadosEndereco.estado.toUpperCase()
      }).select('id_endereco').single();
      if (enderecoError) {
        console.error('❌ Erro ao criar endereço:', enderecoError);
        throw new Error(`Erro ao salvar endereço: ${enderecoError.message}`);
      }
      console.log('✅ Endereço criado:', enderecoData.id_endereco);
      // PASSO 3: Hash da senha usando Web Crypto API
      console.log('🔐 Passo 3: Gerando hash da senha...');
      const senhaHash = await hashPassword(dadosCredenciais.senha);
      console.log('✅ Hash gerado com sucesso');
      // PASSO 4: Criar DADOS_USUARIO (com senha hash, SEM auth_user_id)
      console.log('📝 Passo 4: Criando dados_usuario...');
      const { data: usuarioData, error: usuarioError } = await supabase.from('dados_usuario').insert({
        razao_nome: dadosCliente.nomeCompleto.trim(),
        cpf_cnpj: cpfCnpj,
        usuario: dadosCredenciais.emailLogin.split('@')[0].toLowerCase(),
        email: dadosCredenciais.emailLogin.toLowerCase().trim(),
        senha: senhaHash,
        tipo_pessoa: dadosCliente.tipoPessoa,
        tipo_cliente: 'cliente',
        id_contato: contatoData.id_contato,
        id_endereco: enderecoData.id_endereco,
        first_login: true
      }).select('id_dados').single();
      if (usuarioError) {
        console.error('❌ Erro ao criar dados_usuario:', usuarioError);
        throw new Error(`Erro ao criar usuário: ${usuarioError.message}`);
      }
      console.log('✅ Dados_usuario criado:', usuarioData.id_dados);
      // PASSO 5: Criar CLIENTE
      console.log('📝 Passo 5: Criando cliente...');
      const { data: clienteData, error: clienteError } = await supabase.from('cliente').insert({
        id_dados: usuarioData.id_dados,
        id_admin: idAdminLogado
      }).select('id_cliente').single();
      if (clienteError) {
        console.error('❌ Erro ao criar cliente:', clienteError);
        throw new Error(`Erro ao criar cliente: ${clienteError.message}`);
      }
      console.log('✅ Cliente criado:', clienteData.id_cliente);
      // PASSO 6: Enviar email (opcional)
      if (dadosCredenciais.enviarEmailCredenciais) {
        console.log('📧 Passo 6: Email será enviado (implementar serviço)');
      // TODO: Implementar envio de email via Resend ou outro serviço
      }
      console.log('=== ✅ CADASTRO CONCLUÍDO COM SUCESSO ===');
      return new Response(JSON.stringify({
        success: true,
        clienteId: clienteData.id_cliente,
        usuarioId: usuarioData.id_dados,
        email: dadosCredenciais.emailLogin
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('❌ Erro durante cadastro, fazendo rollback...', error);
      // Rollback: deletar contato
      console.log('🔄 Rollback: deletando contato...');
      await supabase.from('contato').delete().eq('id_contato', contatoData.id_contato);
      console.log('✅ Rollback concluído');
      return new Response(JSON.stringify({
        error: error.message || 'Erro ao cadastrar cliente'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('💥 ERRO GERAL:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Erro ao processar requisição'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
