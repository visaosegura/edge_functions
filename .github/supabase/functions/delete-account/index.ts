import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    console.log('=== INICIANDO DELEÇÃO DE CONTA ===');
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Não autorizado');
    }
    // Create Supabase clients
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('Erro ao obter usuário:', userError);
      throw new Error('Usuário não autenticado');
    }
    console.log('Deletando conta do usuário:', user.id);
    // Get user data from dados_usuario
    const { data: dadosUsuario, error: dadosError } = await supabaseAdmin.from('dados_usuario').select('id_dados, id_contato, id_endereco, tipo_cliente').eq('auth_user_id', user.id).maybeSingle();
    if (dadosError) {
      console.error('Erro ao buscar dados do usuário:', dadosError);
      throw new Error('Erro ao buscar dados do usuário');
    }
    if (!dadosUsuario) {
      console.log('Dados do usuário não encontrados, deletando apenas do Auth');
      await supabaseAdmin.auth.admin.deleteUser(user.id);
      return new Response(JSON.stringify({
        success: true,
        message: 'Conta deletada com sucesso'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Dados do usuário:', dadosUsuario);
    // Delete based on user type
    if (dadosUsuario.tipo_cliente === 'admin') {
      // Delete admin-specific data
      console.log('Deletando dados de admin...');
      // Get admin ID
      const { data: admin } = await supabaseAdmin.from('admin').select('id').eq('id_dados', dadosUsuario.id_dados).maybeSingle();
      if (admin) {
        // Delete branding
        await supabaseAdmin.from('branding').delete().eq('id_admin', admin.id);
        // Delete camera groups
        await supabaseAdmin.from('grupos_cameras').delete().eq('id_admin', admin.id);
        // Delete operators
        await supabaseAdmin.from('operadores').delete().eq('id_admin', admin.id);
        // Get all clients of this admin
        const { data: clients } = await supabaseAdmin.from('cliente').select('id_cliente').eq('id_admin', admin.id);
        if (clients && clients.length > 0) {
          const clientIds = clients.map((c)=>c.id_cliente);
          // Delete cameras of these clients
          await supabaseAdmin.from('cameras').delete().in('id_cliente', clientIds);
          // Delete clients
          await supabaseAdmin.from('cliente').delete().eq('id_admin', admin.id);
        }
        // Delete admin record
        await supabaseAdmin.from('admin').delete().eq('id', admin.id);
      }
    } else if (dadosUsuario.tipo_cliente === 'cliente') {
      // Delete client-specific data
      console.log('Deletando dados de cliente...');
      const { data: cliente } = await supabaseAdmin.from('cliente').select('id_cliente').eq('id_dados', dadosUsuario.id_dados).maybeSingle();
      if (cliente) {
        // Delete cameras
        await supabaseAdmin.from('cameras').delete().eq('id_cliente', cliente.id_cliente);
        // Delete client record
        await supabaseAdmin.from('cliente').delete().eq('id_cliente', cliente.id_cliente);
      }
    }
    // Delete dados_usuario record
    console.log('Deletando dados_usuario...');
    await supabaseAdmin.from('dados_usuario').delete().eq('id_dados', dadosUsuario.id_dados);
    // Delete contact if exists
    if (dadosUsuario.id_contato) {
      console.log('Deletando contato...');
      await supabaseAdmin.from('contato').delete().eq('id_contato', dadosUsuario.id_contato);
    }
    // Delete address if exists
    if (dadosUsuario.id_endereco) {
      console.log('Deletando endereço...');
      await supabaseAdmin.from('endereco').delete().eq('id_endereco', dadosUsuario.id_endereco);
    }
    // Finally, delete auth user
    console.log('Deletando usuário do Auth...');
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      console.error('Erro ao deletar usuário do Auth:', deleteAuthError);
      throw new Error('Erro ao deletar usuário do sistema de autenticação');
    }
    console.log('✅ Conta deletada com sucesso!');
    return new Response(JSON.stringify({
      success: true,
      message: 'Conta deletada com sucesso'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('💥 ERRO AO DELETAR CONTA:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido ao deletar conta'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
