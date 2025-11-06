import { NextResponse } from 'next/server';

/**
 * Proxy endpoint for Thirdweb's x402/fetch API
 * 
 * This endpoint acts as a proxy to Thirdweb's API endpoint:
 * https://api.thirdweb.com/v1/payments/x402/fetch
 * 
 * It keeps the secret key server-side and allows client-side wallets
 * to use Thirdweb's payment processing.
 * 
 * The Thirdweb API handles:
 * 1. Calling the merchant API
 * 2. Detecting 402 Payment Required
 * 3. Creating authorization
 * 4. Settling the transaction on-chain
 * 5. Returning the payment header and result
 */

export async function POST(request) {
  try {
    const thirdwebSecretKey = process.env.THIRDWEB_SECRET_KEY;
    
    if (!thirdwebSecretKey) {
      return NextResponse.json(
        {
          error: 'THIRDWEB_SECRET_KEY not configured',
          message: 'Thirdweb secret key is required for x402/fetch API',
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { url, method = 'GET', from } = body;

    if (!url || !from) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          message: 'url and from (wallet address) are required',
        },
        { status: 400 }
      );
    }

    // Call Thirdweb's x402/fetch API
    const thirdwebApiUrl = 'https://api.thirdweb.com/v1/payments/x402/fetch';
    const queryParams = new URLSearchParams({
      url: url,
      method: method,
      from: from,
    });

    console.log(`🌐 Calling Thirdweb x402/fetch API: ${thirdwebApiUrl}?${queryParams.toString()}`);
    console.log(`Wallet address: ${from}`);

    const response = await fetch(`${thirdwebApiUrl}?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'x-secret-key': thirdwebSecretKey,
        'Content-Type': 'application/json',
      },
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { message: responseText };
    }

    console.log(`Thirdweb API response status: ${response.status}`);
    console.log(`Thirdweb API response:`, responseData);

    // Return the response with the same status code
    // If successful (200), the response contains the purchase data with transaction ID
    // If payment required (402), the response contains funding information
    return NextResponse.json(
      responseData,
      { 
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

  } catch (error) {
    console.error('Error in x402-fetch proxy:', error);
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error.message || 'Failed to call Thirdweb x402/fetch API',
      },
      { status: 500 }
    );
  }
}

