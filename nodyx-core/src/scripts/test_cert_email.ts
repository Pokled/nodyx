import 'dotenv/config'
import { sendCERTTestEmail } from '../services/certEmailService.js'

async function main() {
  console.log('Envoi email de test CERT...')
  const result = await sendCERTTestEmail()

  if (result.sent) {
    console.log('✅ Email envoyé avec succès vers', process.env.CERT_EMAIL_TO)
  } else {
    console.log('❌ Échec :', result.reason)
  }
  process.exit(0)
}

main()
