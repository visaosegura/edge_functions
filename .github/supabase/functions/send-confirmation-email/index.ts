import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
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
    const { email, confirmationUrl, userName } = await req.json();
    console.log('Sending confirmation email to:', email);
    const emailResponse = await resend.emails.send({
      from: "Visão Segura <onboarding@resend.dev>",
      to: [
        email
      ],
      subject: "Confirme seu cadastro - Visão Segura",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Visão Segura</h1>
            </div>
            
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Bem-vindo${userName ? ', ' + userName : ''}!</h2>
              
              <p style="font-size: 16px; color: #555;">
                Obrigado por se cadastrar na Visão Segura. Para ativar sua conta, por favor confirme seu endereço de email clicando no botão abaixo:
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${confirmationUrl}" 
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                          color: white; 
                          padding: 15px 40px; 
                          text-decoration: none; 
                          border-radius: 5px; 
                          font-size: 16px; 
                          font-weight: bold;
                          display: inline-block;">
                  Confirmar Email
                </a>
              </div>
              
              <p style="font-size: 14px; color: #777; margin-top: 30px;">
                Se o botão não funcionar, copie e cole o link abaixo no seu navegador:
              </p>
              <p style="font-size: 12px; color: #999; word-break: break-all;">
                ${confirmationUrl}
              </p>
              
              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #999; text-align: center;">
                Se você não criou esta conta, pode ignorar este email com segurança.
              </p>
            </div>
          </body>
        </html>
      `
    });
    console.log('Email sent successfully:', emailResponse);
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Erro ao enviar email'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
