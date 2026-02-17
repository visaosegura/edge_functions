import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
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
    const { email, password, razaoNome, cpfCnpj, tipoPessoa, usuario, celular } = await req.json();
    // 1. Criar usuário no Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false
    });
    if (authError) throw authError;
    // 2. Gerar link de confirmação
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        redirectTo: `${Deno.env.get('FRONTEND_URL')}/auth/callback`
      }
    });
    if (linkError) {
      console.error('Error generating confirmation link:', linkError);
    }
    // 3. Inserir contato
    const { data: contatoData, error: contatoError } = await supabaseAdmin.from('contato').insert({
      email,
      celular
    }).select().single();
    if (contatoError) throw contatoError;
    // 4. Inserir dados_usuario
    const { data: dadosData, error: dadosError } = await supabaseAdmin.from('dados_usuario').insert({
      auth_user_id: authData.user.id,
      razao_nome: razaoNome,
      cpf_cnpj: cpfCnpj,
      tipo_pessoa: tipoPessoa,
      usuario,
      email,
      tipo_cliente: 'cliente',
      id_contato: contatoData.id_contato
    }).select().single();
    if (dadosError) throw dadosError;
    // 5. Enviar email de confirmação
    if (linkData?.properties?.action_link) {
      try {
        const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-confirmation-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({
            email,
            confirmationUrl: linkData.properties.action_link,
            userName: razaoNome
          })
        });
        if (!emailResponse.ok) {
          console.error('Failed to send confirmation email:', await emailResponse.text());
        } else {
          console.log('Confirmation email sent successfully');
        }
      } catch (emailError) {
        console.error('Error calling send-confirmation-email function:', emailError);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: 'Cadastro realizado com sucesso. Verifique seu email para confirmar.',
      userId: authData.user.id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in complete-signup:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
