import './globals.css'
import { Providers } from '../components/providers'

export const metadata = {
  title: 'x402 Paywall Demo',
  description: 'Demonstration of HTTP 402 Payment Required with x402',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}

