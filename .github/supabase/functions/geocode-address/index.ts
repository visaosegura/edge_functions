import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { address } = await req.json();
    if (!address) {
      throw new Error('Endereço é obrigatório');
    }
    console.log('🔍 Geocodificando endereço:', address);
    // Tentar Photon Geocoder (gratuito, sem API key)
    try {
      const photonResponse = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1&lang=pt`);
      if (photonResponse.ok) {
        const photonData = await photonResponse.json();
        if (photonData.features && photonData.features.length > 0) {
          const coords = photonData.features[0].geometry.coordinates;
          const result = {
            latitude: coords[1],
            longitude: coords[0],
            provider: 'photon'
          };
          console.log('✅ Geocodificação via Photon bem-sucedida:', result);
          return new Response(JSON.stringify(result), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }
    } catch (photonError) {
      console.warn('⚠️ Photon falhou, tentando Nominatim:', photonError);
    }
    // Fallback: Nominatim (com delay para respeitar política de uso)
    await new Promise((resolve)=>setTimeout(resolve, 1000));
    const nominatimResponse = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`, {
      headers: {
        'User-Agent': 'VisaoSegura/1.0'
      }
    });
    if (nominatimResponse.ok) {
      const nominatimData = await nominatimResponse.json();
      if (nominatimData && nominatimData.length > 0) {
        const result = {
          latitude: parseFloat(nominatimData[0].lat),
          longitude: parseFloat(nominatimData[0].lon),
          provider: 'nominatim'
        };
        console.log('✅ Geocodificação via Nominatim bem-sucedida:', result);
        return new Response(JSON.stringify(result), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Nenhum serviço funcionou
    console.log('❌ Não foi possível geocodificar o endereço');
    return new Response(JSON.stringify({
      latitude: null,
      longitude: null,
      error: 'Endereço não encontrado'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao geocodificar:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro ao geocodificar endereço';
    return new Response(JSON.stringify({
      error: errorMessage,
      latitude: null,
      longitude: null
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
