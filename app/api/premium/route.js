/**
 * x402 Protected API Route - /api/premium
 * 
 * This route demonstrates the x402 Payment Required standard:
 * 1. When accessed without payment, returns HTTP 402 with payment instructions
 * 2. When accessed with X-PAYMENT header, verifies payment via facilitator
 * 3. Only grants access if payment is valid
 * 
 * HOW x402 WORKS - DETAILED EXPLANATION:
 * ======================================
 * 
 * STEP 1: Client makes initial request (no payment)
 *   → Browser/frontend calls GET /api/premium
 *   → Server checks for X-PAYMENT header in request
 *   → Header is missing → Server responds with HTTP 402
 *   → 402 response body contains payment requirements:
 *     {
 *       scheme: "exact",
 *       network: "base:84532",
 *       token: "0x...USDC...",
 *       recipient: "0x...merchant...",
 *       amount: 100000  // 0.1 USDC (6 decimals)
 *     }
 * 
 * STEP 2: Client receives 402 and processes payment
 *   → Frontend detects 402 status code
 *   → Extracts payment requirements from response body
 *   → Shows payment UI to user with amount and recipient
 *   → User connects wallet and approves payment
 *   → Wallet creates USDC transfer transaction:
 *     - From: User's wallet
 *     - To: Merchant address (recipient)
 *     - Amount: 100000 (0.1 USDC)
 *     - Network: Base Sepolia (chainId 84532)
 *   → Transaction is signed and broadcast to blockchain
 *   → Transaction is confirmed on-chain
 * 
 * STEP 3: Client gets payment proof from facilitator
 *   → After payment is confirmed, client calls facilitator
 *   → Facilitator URL: https://x402.org/facilitator (testnet)
 *   → Client sends payment transaction details to facilitator
 *   → Facilitator verifies payment on blockchain:
 *     - Checks transaction exists and is confirmed
 *     - Verifies recipient matches merchant address
 *     - Verifies amount matches required amount
 *     - Verifies token is correct USDC
 *   → If valid, facilitator returns signed payment payload
 *   → Payment payload is a cryptographic proof of payment
 * 
 * STEP 4: Client retries request with payment proof
 *   → Client makes same GET /api/premium request again
 *   → This time includes X-PAYMENT header with signed payload
 *   → Server receives request with X-PAYMENT header
 *   → Server calls settlePayment() from thirdweb/x402
 *   → settlePayment() verifies and settles the payment via Thirdweb facilitator
 *   → Facilitator validates the payment payload and settles on-chain if needed
 *   → If valid → Server grants access, returns protected content
 *   → If invalid → Server returns 402 error again
 * 
 * FACILITATOR ROLE - WHY IT EXISTS:
 * ==================================
 * The facilitator is a trusted service that solves several problems:
 * 
 * 1. No Full Node Required: Server doesn't need to run blockchain node
 * 2. Fast Verification: Facilitator has optimized verification logic
 * 3. Standardized Proofs: Provides consistent payment payload format
 * 4. Multi-Network Support: Handles Base, Solana, and other networks
 * 5. Settlement: Can handle complex payment settlement logic
 * 
 * Facilitator: Thirdweb facilitator (requires THIRDWEB_SECRET_KEY and server wallet address)
 * 
 * X-PAYMENT HEADER FORMAT:
 * ========================
 * The X-PAYMENT header contains a signed payment payload (JWT-like structure)
 * that proves payment was made. It includes:
 * - Payment transaction details
 * - Cryptographic signature from facilitator
 * - Verification metadata
 * 
 * This payload is opaque to the client - they just pass it along.
 * Only the facilitator can create and verify these payloads.
 */

import { NextResponse } from 'next/server';
import { decodePayment } from 'x402/schemes';
import fs from 'fs';
import path from 'path';

// Get merchant address from environment variables
// This is where you'll receive USDC payments
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS || '0x0000000000000000000000000000000000000000';

// Network configuration - can be 'base-sepolia' or 'base'
// Default to mainnet for production
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'base';

// USDC token addresses
const USDC_ADDRESSES = {
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet USDC
  'base:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia (chainId format)
  'base:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet (chainId format)
};

// Default to testnet USDC
const USDC_ADDRESS = USDC_ADDRESSES[NETWORK] || USDC_ADDRESSES['base-sepolia'];

// Payment amount: 0.1 USDC = 100000 (USDC has 6 decimals)
// Can be overridden with PAYMENT_AMOUNT environment variable
const PAYMENT_AMOUNT = parseInt(process.env.PAYMENT_AMOUNT || '100000'); // Default: 0.1 USDC

/**
 * GET /api/premium
 * 
 * This is a protected endpoint that requires payment.
 * 
 * PAYMENT VERIFICATION FLOW:
 * 1. Extract X-PAYMENT header from request
 * 2. If missing → Return 402 with payment requirements
 * 3. If present → Verify payment using facilitator
 * 4. If valid → Return protected content
 * 5. If invalid → Return 402 error
 * 
 * @param {Request} request - Next.js request object
 * @returns {NextResponse} - Either 402 (payment required) or 200 (access granted)
 */
export async function GET(request) {
  // STEP 1: Check for X-PAYMENT header
  // This header contains the signed payment proof from the facilitator
  const xPaymentHeader = request.headers.get('x-payment');
  
  // STEP 2: If no payment header, return 402 Payment Required
  // This tells the client what payment is needed
  if (!xPaymentHeader) {
    // Determine network from environment or default to testnet
    const isMainnet = NETWORK === 'base' || NETWORK === 'base:8453';
    const networkChainId = isMainnet ? 'base:8453' : 'base:84532';
    const networkName = isMainnet ? 'Base' : 'Base Sepolia';
    const usdcAddress = isMainnet ? USDC_ADDRESSES['base'] : USDC_ADDRESSES['base-sepolia'];
    
    // Build payment requirements object
    // Include both simplified format for display AND full x402 format for payment creation
    // CRITICAL: Thirdweb facilitator expects network in EIP-155 format: "eip155:8453" or "eip155:84532"
    const networkNameForX402 = isMainnet ? 'eip155:8453' : 'eip155:84532';
    
    // CRITICAL: Use the request URL to construct resource URL to ensure exact match
    // This ensures the resource URL in x402Requirements matches what we'll use for verification
    let resourceUrl;
    if (request.url) {
      // Parse the request URL and use it directly
      const requestUrlObj = new URL(request.url);
      resourceUrl = `${requestUrlObj.origin}${requestUrlObj.pathname}`;
    } else {
      // Fallback to environment variable or default
      resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/premium`;
    }
    
    // Remove trailing slash if present to ensure exact match
    resourceUrl = resourceUrl.replace(/\/$/, '');
    
    const paymentRequirement = {
      // Simplified fields for display (backwards compatibility)
      scheme: 'exact',
      network: networkChainId, // Network: base (8453) or base-sepolia (84532)
      token: usdcAddress, // USDC token contract address
      recipient: MERCHANT_ADDRESS, // Your wallet address to receive payments
      amount: PAYMENT_AMOUNT.toString(), // Amount in smallest unit (6 decimals for USDC)
      displayAmount: `${(PAYMENT_AMOUNT / 1000000).toFixed(6)} USDC`,
      networkName: networkName,
      description: 'Access to premium video content',
      
      // Full x402 payment requirements (for createPaymentHeader)
      // CRITICAL: Use EIP-155 network format for Thirdweb facilitator compatibility
      x402Requirements: {
        scheme: 'exact',
        network: networkNameForX402, // Thirdweb expects "eip155:8453" or "eip155:84532"
        maxAmountRequired: PAYMENT_AMOUNT.toString(),
        resource: resourceUrl,
        description: 'Access to premium video content',
        mimeType: 'video/mp4',
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 86400, // 24 hours - must match Thirdweb facilitator default
        asset: usdcAddress,
      }
    };

    // Return HTTP 402 Payment Required in x402 standard format
    // The Thirdweb API expects payment requirements at the root level, not nested
    // This follows the x402 specification for 402 responses
    return NextResponse.json(
      {
        x402Version: 1,
        ...paymentRequirement.x402Requirements, // Spread x402Requirements at root level for Thirdweb API
        // Also include the full payment object for backward compatibility with our frontend
        payment: paymentRequirement,
      },
      { status: 402 } // HTTP 402 Payment Required
    );
  }

  // STEP 3: Payment header is present - verify it
  try {
    // Decode the payment payload from the X-PAYMENT header
    const paymentPayload = decodePayment(xPaymentHeader);

    console.log('=== PAYMENT VERIFICATION ===');
    console.log('Payment Network:', paymentPayload.network);
    console.log('Payment Scheme:', paymentPayload.scheme);
    console.log('Merchant Address:', MERCHANT_ADDRESS);
    console.log('Payment Amount:', PAYMENT_AMOUNT);

    // Validate environment configuration
    if (!MERCHANT_ADDRESS || MERCHANT_ADDRESS === '0x0000000000000000000000000000000000000000') {
      console.error('❌ MERCHANT_ADDRESS is not set or invalid');
      return NextResponse.json(
        {
          error: 'Configuration error',
          message: 'MERCHANT_ADDRESS must be configured.',
        },
        { status: 500 }
      );
    }

    // Determine network configuration
    const isMainnet = NETWORK === 'base' || NETWORK === 'base:8453';
    const usdcAddress = isMainnet ? USDC_ADDRESSES['base'] : USDC_ADDRESSES['base-sepolia'];

    // Build resource URL from request
    let resourceUrl;
    if (request.url) {
      const requestUrlObj = new URL(request.url);
      resourceUrl = `${requestUrlObj.origin}${requestUrlObj.pathname}`;
    } else {
      resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/premium`;
    }
    resourceUrl = resourceUrl.replace(/\/$/, '');

    // Build payment requirements that match what was sent in the 402 response
    const paymentRequirements = {
      scheme: 'exact',
      network: paymentPayload.network, // Use network from payment payload
      asset: usdcAddress,
      payTo: MERCHANT_ADDRESS,
      maxAmountRequired: PAYMENT_AMOUNT.toString(),
      resource: resourceUrl,
      description: 'Access to premium video content',
      mimeType: 'video/mp4',
      maxTimeoutSeconds: 86400,
      extra: {
        name: 'USD Coin',
        version: '2',
        primaryType: 'TransferWithAuthorization',
        recipientAddress: MERCHANT_ADDRESS,
      }
    };

    // Use the facilitator to verify and settle payment
    // Default to x402.org facilitator
    const facilitatorUrl = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

    console.log('Using facilitator:', facilitatorUrl);
    console.log('Payment requirements:', JSON.stringify(paymentRequirements, null, 2));

    // Call facilitator /settle endpoint
    // This combines verification and settlement in one call
    const facilitatorResponse = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version || 1,
        paymentPayload: paymentPayload,
        paymentRequirements: paymentRequirements,
      }),
    });

    const facilitatorData = await facilitatorResponse.json();

    console.log('Facilitator response status:', facilitatorResponse.status);
    console.log('Facilitator response:', JSON.stringify(facilitatorData, null, 2));

    // Check if settlement was successful
    if (!facilitatorResponse.ok || !facilitatorData.success) {
      console.error('=== PAYMENT SETTLEMENT FAILED ===');
      console.error('Facilitator returned error:', facilitatorData);

      return NextResponse.json(
        {
          x402Version: 1,
          error: facilitatorData.errorReason || 'payment_settlement_failed',
          errorMessage: facilitatorData.errorReason || 'Payment settlement failed. Please try again.',
          accepts: [paymentRequirements],
        },
        { status: 402 }
      );
    }

    // Payment verified and settled successfully!
    console.log('✅ Payment verified and settled!');
    if (facilitatorData.transaction) {
      console.log('Transaction hash:', facilitatorData.transaction);
    }
    if (facilitatorData.payer) {
      console.log('Payer address:', facilitatorData.payer);
    }

    // STEP 5: Payment is valid! Grant access to protected content
    // At this point, we know:
    // - Payment was made on-chain
    // - Payment matches our requirements
    // - Payment proof is valid and verified by facilitator
    // 
    // Now we can safely return the protected video resource
    const videoRelativePath = process.env.VIDEO_PATH || path.join('resources ', 'ssstik.io_@wilcoxxspace_1761512614937.mp4');
    
    try {
      // Get the absolute path to the video file
      const videoAbsolutePath = path.isAbsolute(videoRelativePath) 
        ? videoRelativePath 
        : path.join(process.cwd(), videoRelativePath);
      
      // Check if file exists
      if (!fs.existsSync(videoAbsolutePath)) {
        console.error('Video file not found at:', videoAbsolutePath);
        return NextResponse.json(
          {
            error: 'Video file not found',
            message: 'The protected video resource is not available.',
          },
          { status: 500 }
        );
      }
      
      // Read the video file
      const videoBuffer = fs.readFileSync(videoAbsolutePath);
      const videoStats = fs.statSync(videoAbsolutePath);
      
      // Return the video file with proper headers
      return new NextResponse(videoBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoStats.size.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache',
          'X-Payment-Verified': 'true',
          'X-Payment-Network': NETWORK,
        },
      });
    } catch (fileError) {
      console.error('Error serving video file:', fileError);
      // No fallback - this is a production error
      return NextResponse.json(
        {
          error: 'Video file error',
          message: 'Payment verified but video file could not be served.',
          details: fileError.message,
        },
        { status: 500 }
      );
    }

  } catch (error) {
    // Error during payment verification
    // This could be:
    // - Network error connecting to facilitator
    // - Invalid payment payload format
    // - Facilitator service unavailable
    console.error('Payment verification error:', error);
    
    return NextResponse.json(
      {
        error: 'Payment verification error',
        message: error.message || 'Failed to verify payment. Please try again.',
        hint: 'The facilitator service may be temporarily unavailable.'
      },
      { status: 402 }
    );
  }
}

