import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const handler = async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, name, password } = await req.json();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: "Visão Segura <onboarding@resend.dev>",
        to: [
          email
        ],
        subject: "Bem-vindo ao Visão Segura - Suas Credenciais de Acesso",
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
              color: white;
              padding: 30px;
              border-radius: 10px 10px 0 0;
              text-align: center;
            }
            .content {
              background: #ffffff;
              padding: 30px;
              border: 1px solid #e5e7eb;
              border-top: none;
            }
            .credentials-box {
              background: #f9fafb;
              border: 2px solid #e5e7eb;
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
            }
            .credential-item {
              margin: 10px 0;
              padding: 10px;
              background: white;
              border-radius: 5px;
            }
            .credential-label {
              font-weight: 600;
              color: #6b7280;
              font-size: 14px;
              display: block;
              margin-bottom: 5px;
            }
            .credential-value {
              font-size: 16px;
              color: #111827;
              font-family: 'Courier New', monospace;
              word-break: break-all;
            }
            .button {
              display: inline-block;
              background: #f97316;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 6px;
              margin: 20px 0;
              font-weight: 600;
            }
            .footer {
              background: #f9fafb;
              padding: 20px;
              text-align: center;
              font-size: 14px;
              color: #6b7280;
              border-radius: 0 0 10px 10px;
            }
            .warning {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin: 0;">Bem-vindo ao Visão Segura!</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Sistema de Monitoramento de Câmeras</p>
          </div>
          
          <div class="content">
            <h2>Olá, ${name}!</h2>
            
            <p>Sua conta foi criada com sucesso! Você agora tem acesso ao sistema Visão Segura para monitorar suas câmeras de segurança.</p>
            
            <div class="credentials-box">
              <h3 style="margin-top: 0; color: #111827;">Suas Credenciais de Acesso</h3>
              
              <div class="credential-item">
                <span class="credential-label">Email de Login:</span>
                <span class="credential-value">${email}</span>
              </div>
              
              <div class="credential-item">
                <span class="credential-label">Senha Temporária:</span>
                <span class="credential-value">${password}</span>
              </div>
            </div>
            
            <div class="warning">
              <strong>⚠️ Importante:</strong> Por questões de segurança, recomendamos que você altere sua senha no primeiro acesso ao sistema.
            </div>
            
            <div style="text-align: center;">
              <a href="${Deno.env.get("FRONTEND_URL") || "http://localhost:8080"}/login" class="button">
                Acessar o Sistema
              </a>
            </div>
            
            <h3>Próximos Passos:</h3>
            <ol>
              <li>Acesse o sistema usando suas credenciais</li>
              <li>Altere sua senha nas configurações de perfil</li>
              <li>Configure suas preferências de notificação</li>
              <li>Comece a visualizar suas câmeras</li>
            </ol>
            
            <p>Se você tiver alguma dúvida ou precisar de ajuda, não hesite em entrar em contato com nossa equipe de suporte.</p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© ${new Date().getFullYear()} Visão Segura. Todos os direitos reservados.</p>
            <p style="margin: 10px 0 0 0;">
              Este é um email automático, por favor não responda.
            </p>
          </div>
        </body>
        </html>
      `
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to send email");
    }
    const emailResponse = await response.json();
    console.log("Email sent successfully:", emailResponse);
    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in send-client-credentials function:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);
