# 🩺 x402 Micro-Consultation Paywall

A complete Next.js implementation demonstrating the **x402 Payment Required** standard with detailed explanations of how the payment flow works.

## Overview

This project demonstrates how to build a **pay-per-access endpoint** using the **x402 Payment Required** standard on **Base Sepolia** testnet, accepting **USDC** payments through an **x402 facilitator**.

### Key Features

- ✅ Complete x402 payment flow implementation
- ✅ Detailed code comments explaining each step
- ✅ Interactive frontend UI to test the payment flow
- ✅ Next.js App Router with API routes
- ✅ Testnet-ready configuration (Base Sepolia)
- ✅ Comprehensive error handling
- ✅ Step-by-step payment process visualization

## How x402 Works

### The Payment Flow

1. **Client Request**: User attempts to access protected content
2. **402 Response**: Server returns HTTP 402 Payment Required with payment details
3. **Payment Processing**: User completes payment through wallet
4. **Payment Proof**: Facilitator verifies payment and provides proof
5. **Access Granted**: Client retries with payment proof, server verifies and grants access

### Key Concepts

- **HTTP 402**: Standard status code for payment-required responses
- **X-PAYMENT Header**: Contains signed payment proof from facilitator
- **Facilitator**: Trusted service that verifies payments on-chain
- **Payment Payload**: Cryptographic proof of payment (signed by facilitator)

For detailed explanations, see the code comments in `app/api/premium/route.js`.

## Prerequisites

- Node.js 18+ and npm
- A crypto wallet (MetaMask, Coinbase Wallet, etc.)
- Base Sepolia testnet configured in wallet
- Test USDC tokens (get from Circle Testnet Faucet)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install:
- Next.js 14
- React 18
- x402-express (for Express middleware - optional)
- @coinbase/x402 (for payment verification)
- Tailwind CSS (for styling)

### 2. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
# Your wallet address where you'll receive USDC payments
# Use a Base Sepolia testnet address for testing
MERCHANT_ADDRESS=0xYourMerchantWalletAddress

# Network configuration
NEXT_PUBLIC_NETWORK=base-sepolia
```

You can copy `env.example` as a template:

```bash
cp env.example .env.local
```

### 3. Get Test Tokens

**Base Sepolia ETH:**
- Use [Base Sepolia Faucet](https://docs.base.org/docs/tools/faucet)
- Or Alchemy/Infura faucets

**Base Sepolia USDC:**
- Use Circle Testnet Faucet to mint USDC

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Test the Payment Flow

1. Click "Access Premium Content" button
2. Observe the 402 Payment Required response
3. Review payment requirements displayed
4. Click "Process Payment (Demo)" to simulate payment
5. See the success state with access granted

## Project Structure

```
x402-paywall/
├── app/
│   ├── api/
│   │   └── premium/
│   │       └── route.js      # Protected API endpoint with x402
│   ├── page.js               # Frontend UI with payment flow
│   ├── layout.js             # Next.js layout
│   └── globals.css           # Global styles
├── env.example               # Environment variable template
├── next.config.js            # Next.js configuration
├── tailwind.config.js        # Tailwind CSS configuration
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## Understanding the Code

### Backend: `app/api/premium/route.js`

This file contains the protected API endpoint with extensive comments explaining:

- How 402 responses are generated
- Payment requirement format
- Payment verification process
- Facilitator integration
- Error handling

**Key Functions:**
- `GET()` - Handles incoming requests
- Checks for `X-PAYMENT` header
- Returns 402 if payment missing
- Verifies payment with facilitator if header present
- Grants access if payment valid

### Frontend: `app/page.js`

This file implements the complete payment flow UI:

- Step-by-step visualization
- Payment requirement display
- Payment processing simulation
- Success/error states
- Technical details panel

**Key Features:**
- Interactive payment flow
- Real-time status updates
- Detailed explanations
- Error handling UI

## Network Configuration

### Base Sepolia (Testnet)

- **Chain ID**: 84532
- **RPC URL**: `https://sepolia.base.org`
- **USDC Address**: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Facilitator**: `https://x402.org/facilitator`

### Mainnet (Production)

To switch to mainnet:

1. Update `MERCHANT_ADDRESS` to mainnet address
2. Set `NEXT_PUBLIC_NETWORK=base`
3. Get CDP API keys from [cdp.coinbase.com](https://cdp.coinbase.com)
4. Update facilitator configuration in `route.js`
5. Use mainnet USDC address

## API Endpoints

### GET /api/premium

Protected endpoint that requires payment.

**Request (without payment):**
```bash
curl http://localhost:3000/api/premium
```

**Response (402 Payment Required):**
```json
{
  "message": "Payment required to access this resource.",
  "payment": {
    "scheme": "exact",
    "network": "base:84532",
    "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "recipient": "0xYourMerchantAddress",
    "amount": "100000",
    "displayAmount": "0.1 USDC"
  }
}
```

**Request (with payment):**
```bash
curl -H "X-PAYMENT: <payment-payload>" http://localhost:3000/api/premium
```

**Response (200 OK):**
```json
{
  "access": "granted",
  "content": "https://example.com/premium-consultation-video.mp4",
  "message": "Payment verified! Access granted to premium content.",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Payment Flow Deep Dive

### Step 1: Initial Request
```javascript
// Client makes request without X-PAYMENT header
fetch('/api/premium')
```

### Step 2: Server Response (402)
```javascript
// Server detects missing header and returns 402
{
  status: 402,
  body: {
    payment: {
      amount: "100000",
      recipient: "0x...",
      network: "base:84532",
      token: "0x..."
    }
  }
}
```

### Step 3: Payment Processing
```javascript
// User approves transaction in wallet
// Transaction is broadcast to blockchain
// Wait for confirmation
```

### Step 4: Get Payment Proof
```javascript
// Call facilitator with transaction details
// Facilitator verifies on-chain
// Returns signed payment payload
const paymentPayload = await getPaymentProof(transactionHash);
```

### Step 5: Retry with Payment
```javascript
// Include X-PAYMENT header in retry
fetch('/api/premium', {
  headers: {
    'X-PAYMENT': paymentPayload
  }
})
```

## Testing

### Manual Testing

1. Start the dev server: `npm run dev`
2. Open browser to `http://localhost:3000`
3. Click "Access Premium Content"
4. Verify 402 response is received
5. Check payment requirements are displayed
6. Test payment processing flow

### Using curl

**Test 402 response:**
```bash
curl -i http://localhost:3000/api/premium
```

**Test with payment (requires valid payment payload):**
```bash
curl -H "X-PAYMENT: <valid-payment-payload>" http://localhost:3000/api/premium
```

## Troubleshooting

### Common Issues

**1. "MERCHANT_ADDRESS not set"**
- Ensure `.env.local` exists with `MERCHANT_ADDRESS`
- Restart dev server after adding env vars

**2. "Payment verification failed"**
- Check facilitator URL is correct
- Verify network is Base Sepolia
- Ensure payment payload is valid

**3. "Module not found" errors**
- Run `npm install` to install dependencies
- Check Node.js version (18+)

**4. Tailwind styles not working**
- Ensure `tailwind.config.js` includes app directory
- Restart dev server

## Next Steps

1. **Real Wallet Integration**: Connect MetaMask or Coinbase Wallet
2. **Payment Processing**: Implement actual USDC transfer
3. **Facilitator Integration**: Call facilitator API to get payment proof
4. **Production Deployment**: Deploy to Vercel or similar
5. **Mainnet Setup**: Configure for Base mainnet

## Resources

- [x402 Documentation](https://docs.cdp.coinbase.com/x402)
- [Base Sepolia Faucet](https://docs.base.org/docs/tools/faucet)
- [CDP Portal](https://cdp.coinbase.com)
- [x402 Discord](https://discord.gg/x402)

## License

ISC

## Support

For questions or issues:
- Check the [x402 Documentation](https://docs.cdp.coinbase.com/x402)
- Join the [x402 Discord](https://discord.gg/x402)
- Review code comments for detailed explanations

---

**Built with ❤️ to demonstrate the x402 Payment Required standard**

