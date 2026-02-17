import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('🔵 [create-client] Iniciando cadastro de cliente...');
    const requestBody = await req.json();
    console.log('📥 Request body completo:', JSON.stringify(requestBody, null, 2));
    const { dadosCliente, dadosContato, dadosEndereco, dadosCredenciais, idAdminLogado } = requestBody;
    console.log('📥 Dados recebidos:', {
      cliente: dadosCliente?.nomeCompleto,
      tipoPessoa: dadosCliente?.tipoPessoa,
      cpf: dadosCliente?.cpf,
      cnpj: dadosCliente?.cnpj,
      email: dadosCredenciais?.emailLogin,
      emailContato: dadosContato?.email,
      celular: dadosContato?.celular,
      adminId: idAdminLogado
    });
    // Validar dados obrigatórios
    if (!dadosCliente.nomeCompleto || !dadosCredenciais.emailLogin || !dadosCredenciais.senha || !idAdminLogado) {
      console.error('❌ Dados obrigatórios ausentes');
      return new Response(JSON.stringify({
        error: 'Dados obrigatórios ausentes'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 1. Verificar se email já existe
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const emailExists = existingUser?.users?.some((u)=>u.email === dadosCredenciais.emailLogin);
    if (emailExists) {
      console.error('❌ Email já cadastrado:', dadosCredenciais.emailLogin);
      return new Response(JSON.stringify({
        error: 'Email já está cadastrado no sistema'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 1.5. Verificar se CNPJ já existe ANTES de criar usuário no Auth
    const cpfCnpjLimpo = (dadosCliente.cpf || dadosCliente.cnpj || '').replace(/\D/g, '');
    console.log('🔍 Verificando CNPJ antes de criar usuário:', cpfCnpjLimpo);
    const { data: existingCpfCnpj, error: checkError } = await supabase.from('dados_usuario').select('id_dados, razao_nome, email, tipo_cliente, created_at, auth_user_id').eq('cpf_cnpj', cpfCnpjLimpo).maybeSingle();
    if (checkError) {
      console.error('❌ Erro ao verificar CNPJ existente:', checkError);
    }
    if (existingCpfCnpj) {
      console.log('⚠️ CNPJ já existe no banco. Verificando se é registro incompleto...');
      // Verificar se o registro tem cliente associado (cadastro completo)
      const { data: existingCliente } = await supabase.from('cliente').select('id_cliente').eq('id_dados', existingCpfCnpj.id_dados).maybeSingle();
      if (existingCliente) {
        // Registro completo existe - retornar erro
        console.error('❌ CNPJ já cadastrado com cliente completo:', {
          id_dados: existingCpfCnpj.id_dados,
          razao_nome: existingCpfCnpj.razao_nome,
          email: existingCpfCnpj.email,
          id_cliente: existingCliente.id_cliente
        });
        return new Response(JSON.stringify({
          error: `CNPJ ${cpfCnpjLimpo} já está cadastrado no sistema. Registro existente: ${existingCpfCnpj.razao_nome} (${existingCpfCnpj.email})`
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } else {
        // Registro incompleto (sem cliente) - limpar ANTES de criar novo usuário
        console.log('🧹 Registro incompleto encontrado. Limpando antes de criar novo cadastro...');
        console.log('📋 Registro a ser removido:', {
          id_dados: existingCpfCnpj.id_dados,
          razao_nome: existingCpfCnpj.razao_nome,
          email: existingCpfCnpj.email
        });
        // Deletar contato e endereço se existirem
        const { data: dadosUsuarioCompleto } = await supabase.from('dados_usuario').select('id_contato, id_endereco').eq('id_dados', existingCpfCnpj.id_dados).single();
        if (dadosUsuarioCompleto) {
          if (dadosUsuarioCompleto.id_contato) {
            await supabase.from('contato').delete().eq('id_contato', dadosUsuarioCompleto.id_contato);
            console.log('✅ Contato deletado:', dadosUsuarioCompleto.id_contato);
          }
          if (dadosUsuarioCompleto.id_endereco) {
            await supabase.from('endereco').delete().eq('id_endereco', dadosUsuarioCompleto.id_endereco);
            console.log('✅ Endereço deletado:', dadosUsuarioCompleto.id_endereco);
          }
        }
        // Deletar dados_usuario usando função SQL (mais confiável)
        console.log('🗑️ Chamando função SQL para limpar registro incompleto...');
        console.log('📋 Parâmetros:', {
          cnpj: cpfCnpjLimpo,
          id_dados: existingCpfCnpj.id_dados
        });
        // Tentar primeiro por id_dados (mais confiável)
        const { data: cleanupResult, error: cleanupError } = await supabase.rpc('cleanup_incomplete_client', {
          id_dados_to_clean: existingCpfCnpj.id_dados,
          cnpj_to_clean: null
        });
        // Se falhar, tentar por CNPJ
        let finalResult = cleanupResult;
        if (cleanupError || !cleanupResult || cleanupResult.length === 0 || !cleanupResult[0]?.deleted) {
          console.log('🔄 Tentando limpeza por CNPJ...');
          const { data: cleanupByCnpj, error: cleanupByCnpjError } = await supabase.rpc('cleanup_incomplete_client', {
            cnpj_to_clean: cpfCnpjLimpo,
            id_dados_to_clean: null
          });
          if (!cleanupByCnpjError && cleanupByCnpj && cleanupByCnpj.length > 0) {
            finalResult = cleanupByCnpj;
          }
        }
        if (cleanupError && !finalResult) {
          console.error('❌ Erro ao chamar função de limpeza:', cleanupError);
          // Tentar deleção direta como fallback
          console.log('🔄 Tentando deleção direta como fallback...');
          await supabase.from('dados_usuario').delete().eq('id_dados', existingCpfCnpj.id_dados);
        } else if (finalResult && finalResult.length > 0) {
          const result = finalResult[0];
          if (result.deleted) {
            console.log('✅ Limpeza bem-sucedida via função SQL:', result.message);
          } else {
            console.error('❌ Limpeza falhou:', result.message);
            // Se falhou porque é registro completo, retornar erro
            if (result.message.includes('completo')) {
              return new Response(JSON.stringify({
                error: `CNPJ ${cpfCnpjLimpo} já está cadastrado no sistema com registro completo.`
              }), {
                status: 400,
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json'
                }
              });
            }
          }
        }
        // Verificar se foi realmente deletado
        const { data: finalVerify } = await supabase.from('dados_usuario').select('id_dados, cpf_cnpj').eq('cpf_cnpj', cpfCnpjLimpo).maybeSingle();
        if (finalVerify) {
          console.error('❌ ATENÇÃO: Registro ainda existe após limpeza!');
          console.error('❌ id_dados:', finalVerify.id_dados);
          // Retornar erro informando que precisa limpeza manual
          return new Response(JSON.stringify({
            error: `Não foi possível limpar registro incompleto com CNPJ ${cpfCnpjLimpo}. Por favor, execute a limpeza manual no banco de dados ou entre em contato com o suporte.`
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
          console.log('✅ Confirmação: Registro foi deletado com sucesso');
        }
        // Deletar usuário do Auth se existir
        if (existingCpfCnpj.auth_user_id) {
          try {
            await supabase.auth.admin.deleteUser(existingCpfCnpj.auth_user_id);
            console.log('✅ Usuário Auth deletado:', existingCpfCnpj.auth_user_id);
          } catch (authDeleteError) {
            console.warn('⚠️ Erro ao deletar usuário Auth (pode não existir):', authDeleteError);
          }
        }
        console.log('✅ Limpeza concluída. Continuando com cadastro...');
      }
    }
    // 2. Criar usuário no Supabase Auth
    console.log('👤 Criando usuário no Supabase Auth...');
    // Garantir que CPF/CNPJ está sem máscara no metadata também
    const cpfCnpjMetadata = (dadosCliente.cpf || dadosCliente.cnpj || '').replace(/\D/g, '');
    // Criar usuário no Auth
    // Se enviarEmailCredenciais for true, usar inviteUserByEmail (envia email automaticamente)
    // Caso contrário, criar já confirmado
    let authData;
    let authError;
    if (dadosCredenciais.enviarEmailCredenciais) {
      console.log('📧 Criando usuário e enviando email de confirmação...');
      // Removed erroneous SQL block injected accidentally by migration
      // Configurar redirectTo para redirecionar após confirmação
      // Prioridade: Origin/Referer (da requisição) > SITE_URL (variável de ambiente) > URL padrão
      const origin = req.headers.get('origin') || req.headers.get('referer');
      let siteUrl = Deno.env.get('SITE_URL') || Deno.env.get('LOVABLE_URL');
      // Tentar extrair a URL base do Origin ou Referer
      if (origin) {
        try {
          const originUrl = new URL(origin);
          siteUrl = `${originUrl.protocol}//${originUrl.host}`;
          console.log('🔗 URL detectada do header da requisição:', siteUrl);
        } catch (e) {
          console.warn('⚠️ Não foi possível extrair URL do header:', origin);
        }
      }
      // Fallback para URL padrão se não encontrou
      if (!siteUrl) {
        siteUrl = 'https://preview--visao-segura-upconnect.lovable.app';
        console.warn('⚠️ Usando URL padrão do Lovable. Configure SITE_URL nas variáveis de ambiente da edge function.');
      }
      // Garantir que a URL não tenha barra no final e adicionar /auth/callback
      const siteUrlClean = siteUrl.replace(/\/$/, ''); // Remove barra final se existir
      const callbackUrl = `${siteUrlClean}/auth/callback`;
      console.log('🔗 URL de redirecionamento configurada:', callbackUrl);
      // 1. PRIMEIRO: Criar usuário com senha (mas NÃO confirmado)
      console.log('👤 Passo 1: Criando usuário com senha...');
      const createResult = await supabase.auth.admin.createUser({
        email: dadosCredenciais.emailLogin?.toLowerCase().trim() || '',
        password: dadosCredenciais.senha,
        email_confirm: false,
        user_metadata: {
          razao_nome: dadosCliente.nomeCompleto?.trim() || '',
          cpf_cnpj: cpfCnpjMetadata,
          tipo_pessoa: dadosCliente.tipoPessoa,
          tipo_cliente: 'cliente'
        }
      });
      authData = createResult.data;
      authError = createResult.error;
      if (authError) {
        console.error('❌ Erro ao criar usuário:', authError);
        return new Response(JSON.stringify({
          error: `Erro ao criar usuário: ${authError.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      if (!authData?.user) {
        console.error('❌ Usuário não foi criado');
        return new Response(JSON.stringify({
          error: 'Erro ao criar usuário: dados não retornados'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('✅ Usuário criado com sucesso:', authData.user.id);
      // 2. AGORA: Enviar email de confirmação (SEM metadata extra, pois já está no user_metadata)
      console.log('📧 Passo 2: Enviando email de confirmação...');
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(dadosCredenciais.emailLogin?.toLowerCase().trim() || '', {
        redirectTo: callbackUrl
      });
      if (inviteError) {
        console.error('❌ Erro ao enviar email:', inviteError);
        // Limpar usuário criado em caso de erro
        await supabase.auth.admin.deleteUser(authData.user.id);
        return new Response(JSON.stringify({
          error: `Erro ao enviar email: ${inviteError.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('✅ Email de confirmação enviado com sucesso');
      console.log('📧 redirectTo usado:', callbackUrl);
    } else {
      // Criar usuário já confirmado (sem enviar email)
      console.log('👤 Criando usuário já confirmado (sem email de confirmação)...');
      const createResult = await supabase.auth.admin.createUser({
        email: dadosCredenciais.emailLogin?.toLowerCase().trim() || '',
        password: dadosCredenciais.senha,
        email_confirm: true,
        user_metadata: {
          razao_nome: dadosCliente.nomeCompleto?.trim() || '',
          cpf_cnpj: cpfCnpjMetadata,
          tipo_pessoa: dadosCliente.tipoPessoa,
          tipo_cliente: 'cliente'
        }
      });
      authData = createResult.data;
      authError = createResult.error;
    }
    if (authError) {
      console.error('❌ Erro ao criar usuário no Auth:', authError);
      return new Response(JSON.stringify({
        error: `Erro ao criar usuário: ${authError.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Usuário criado no Auth:', authData.user.id);
    // 3. Inserir contato
    console.log('📞 Inserindo contato...');
    // Garantir que telefones estão sem máscara
    const celularLimpo = dadosContato.celular?.replace(/\D/g, '') || '';
    const telefoneLimpo = dadosContato.telefone ? dadosContato.telefone.replace(/\D/g, '') : null;
    const { data: contatoData, error: contatoError } = await supabase.from('contato').insert({
      email: dadosContato.email?.toLowerCase().trim() || '',
      celular: celularLimpo,
      telefone: telefoneLimpo,
      redes_sociais: dadosContato.redesSociais || null
    }).select().single();
    if (contatoError) {
      console.error('❌ Erro ao inserir contato:', contatoError);
      // Deletar usuário criado
      await supabase.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({
        error: `Erro ao inserir contato: ${contatoError.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Contato inserido:', contatoData.id_contato);
    // 4. Inserir endereço
    console.log('🏠 Inserindo endereço...');
    // Garantir que CEP está sem máscara
    const cepLimpo = dadosEndereco.cep?.replace(/\D/g, '') || '';
    const { data: enderecoData, error: enderecoError } = await supabase.from('endereco').insert({
      cep: cepLimpo,
      rua: dadosEndereco.rua?.trim() || '',
      numero: dadosEndereco.numero?.trim() || '',
      complemento: dadosEndereco.complemento?.trim() || null,
      bairro: dadosEndereco.bairro?.trim() || '',
      cidade: dadosEndereco.cidade?.trim() || '',
      estado: dadosEndereco.estado?.toUpperCase() || ''
    }).select().single();
    if (enderecoError) {
      console.error('❌ Erro ao inserir endereço:', enderecoError);
      // Limpar dados criados
      await supabase.from('contato').delete().eq('id_contato', contatoData.id_contato);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({
        error: `Erro ao inserir endereço: ${enderecoError.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Endereço inserido:', enderecoData.id_endereco);
    // 5. Inserir dados_usuario
    console.log('📋 Inserindo dados_usuario...');
    // Garantir que CPF/CNPJ está sem máscara (camada extra de segurança)
    const cpfCnpjLimpoFinal = (dadosCliente.cpf || dadosCliente.cnpj || '').replace(/\D/g, '');
    console.log('🔍 CPF/CNPJ final (sem máscara):', cpfCnpjLimpoFinal);
    // Verificação FINAL antes de inserir (para garantir que não há duplicação)
    console.log('🔍 Verificação final: checando se CNPJ ainda existe...');
    const { data: finalCheck, error: finalCheckError } = await supabase.from('dados_usuario').select('id_dados, razao_nome, email').eq('cpf_cnpj', cpfCnpjLimpoFinal).maybeSingle();
    if (finalCheckError) {
      console.error('❌ Erro na verificação final:', finalCheckError);
    }
    if (finalCheck) {
      console.error('❌ ATENÇÃO: CNPJ ainda existe após limpeza!', {
        id_dados: finalCheck.id_dados,
        razao_nome: finalCheck.razao_nome,
        email: finalCheck.email
      });
      // Limpar dados criados
      await supabase.from('endereco').delete().eq('id_endereco', enderecoData.id_endereco);
      await supabase.from('contato').delete().eq('id_contato', contatoData.id_contato);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({
        error: `CNPJ ${cpfCnpjLimpoFinal} ainda está cadastrado no sistema. Por favor, tente novamente ou entre em contato com o suporte.`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Verificação final OK - CNPJ não existe, prosseguindo com inserção...');
    const { data: dadosUsuarioData, error: dadosUsuarioError } = await supabase.from('dados_usuario').insert({
      auth_user_id: authData.user.id,
      razao_nome: dadosCliente.nomeCompleto?.trim() || '',
      cpf_cnpj: cpfCnpjLimpoFinal,
      tipo_pessoa: dadosCliente.tipoPessoa,
      tipo_cliente: 'cliente',
      usuario: dadosCredenciais.emailLogin?.toLowerCase().trim() || '',
      email: dadosCredenciais.emailLogin?.toLowerCase().trim() || '',
      id_contato: contatoData.id_contato,
      id_endereco: enderecoData.id_endereco,
      first_login: true
    }).select().single();
    if (dadosUsuarioError) {
      console.error('❌ Erro ao inserir dados_usuario:', dadosUsuarioError);
      console.error('❌ Detalhes completos do erro:', JSON.stringify(dadosUsuarioError, null, 2));
      console.error('❌ CNPJ que tentou inserir:', cpfCnpjLimpoFinal);
      // Se for erro de duplicação, verificar novamente o que existe
      if (dadosUsuarioError.code === '23505') {
        console.error('🔍 Erro de duplicação detectado! Verificando novamente...');
        const { data: duplicateCheck } = await supabase.from('dados_usuario').select('*').eq('cpf_cnpj', cpfCnpjLimpo).maybeSingle();
        console.error('🔍 Resultado da verificação de duplicado:', duplicateCheck);
        if (duplicateCheck) {
          console.error('⚠️ Registro duplicado encontrado:', {
            id_dados: duplicateCheck.id_dados,
            razao_nome: duplicateCheck.razao_nome,
            email: duplicateCheck.email,
            created_at: duplicateCheck.created_at
          });
        } else {
          console.error('⚠️ ATENÇÃO: Erro de duplicação mas registro não encontrado na verificação!');
          console.error('⚠️ Isso pode indicar um problema de transação ou cache.');
        }
      }
      // Limpar dados criados
      await supabase.from('endereco').delete().eq('id_endereco', enderecoData.id_endereco);
      await supabase.from('contato').delete().eq('id_contato', contatoData.id_contato);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({
        error: `Erro ao inserir dados do usuário: ${dadosUsuarioError.message}`,
        details: dadosUsuarioError.code === '23505' ? 'CNPJ já cadastrado no sistema' : dadosUsuarioError.details
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ dados_usuario inserido:', dadosUsuarioData.id_dados);
    // 6. Inserir cliente
    console.log('👤 Inserindo cliente...');
    const { data: clienteData, error: clienteError } = await supabase.from('cliente').insert({
      id_dados: dadosUsuarioData.id_dados,
      id_admin: idAdminLogado
    }).select().single();
    if (clienteError) {
      console.error('❌ Erro ao inserir cliente:', clienteError);
      // Limpar dados criados
      await supabase.from('dados_usuario').delete().eq('id_dados', dadosUsuarioData.id_dados);
      await supabase.from('endereco').delete().eq('id_endereco', enderecoData.id_endereco);
      await supabase.from('contato').delete().eq('id_contato', contatoData.id_contato);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({
        error: `Erro ao inserir cliente: ${clienteError.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('✅ Cliente inserido:', clienteData.id_cliente);
    // 7. Atribuir role de cliente
    console.log('🔑 Atribuindo role de cliente...');
    const { error: roleError } = await supabase.from('user_roles').insert({
      user_id: authData.user.id,
      role: 'client' // Enum app_role aceita apenas 'admin' ou 'client'
    });
    if (roleError) {
      console.warn('⚠️ Erro ao atribuir role (não crítico):', roleError);
    }
    console.log('✅ Cliente cadastrado com sucesso!');
    if (dadosCredenciais.enviarEmailCredenciais) {
      console.log('📧 Email de confirmação enviado automaticamente via inviteUserByEmail (mesmo método do admin)');
      console.log('📧 O cliente receberá um email para confirmar a conta antes do primeiro login');
    } else {
      console.log('ℹ️ Email de confirmação não solicitado - usuário já confirmado');
    }
    return new Response(JSON.stringify({
      success: true,
      clientId: clienteData.id_cliente,
      userId: authData.user.id,
      email: dadosCredenciais.emailLogin,
      needsConfirmation: dadosCredenciais.enviarEmailCredenciais
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('💥 Erro não tratado:', error);
    console.error('💥 Stack trace:', error instanceof Error ? error.stack : 'N/A');
    const errorMessage = error instanceof Error ? error.message : 'Erro interno do servidor';
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : {
      message: String(error)
    };
    console.error('💥 Detalhes completos do erro:', JSON.stringify(errorDetails, null, 2));
    return new Response(JSON.stringify({
      error: errorMessage,
      details: (()=>{
        try {
          return Deno?.env?.get('NODE_ENV') === 'development';
        } catch  {
          return false;
        }
      })() ? errorDetails : undefined
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
