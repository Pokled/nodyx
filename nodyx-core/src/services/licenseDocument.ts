/**
 * Attestation de provenance musicale (PDF), une par catégorie.
 *
 * Ne formule AUCUNE affirmation juridique de notre cru (pas "tous droits
 * cédés", pas de conclusion sur la titularité) : ce document rapporte ce que
 * l'admin a écrit dans license_note (studio, jeu, outil utilisé, conditions
 * applicables) et laisse le texte faire foi. C'est une preuve de provenance
 * datée, pas un avis juridique.
 */

import PDFDocument from 'pdfkit'

export interface LicenseDocInput {
  categoryTitle: string
  licenseNote:   string
  communityName: string
  trackTitles:   string[]
  generatedAt:   Date
}

export async function generateLicensePdf(input: LicenseDocInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc
      .font('Helvetica-Bold').fontSize(18)
      .text('Attestation de provenance musicale', { align: 'left' })
      .moveDown(0.3)
      .font('Helvetica').fontSize(10).fillColor('#555555')
      .text(`Généré le ${input.generatedAt.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })} depuis ${input.communityName}`)
      .moveDown(1.2)
      .fillColor('#000000')

    doc.font('Helvetica-Bold').fontSize(12).text('Catégorie / ambiance')
    doc.font('Helvetica').fontSize(11).text(input.categoryTitle).moveDown(0.8)

    if (input.trackTitles.length > 0) {
      doc.font('Helvetica-Bold').fontSize(12).text('Morceaux concernés')
      doc.font('Helvetica').fontSize(11)
      for (const t of input.trackTitles) doc.text(`• ${t}`)
      doc.moveDown(0.8)
    }

    doc.font('Helvetica-Bold').fontSize(12).text('Note de licence')
    doc.font('Helvetica').fontSize(11).text(input.licenseNote, { align: 'left' })
    doc.moveDown(1.2)

    doc
      .font('Helvetica-Oblique').fontSize(9).fillColor('#777777')
      .text(
        "Ce document rapporte les informations fournies par l'administrateur de l'instance au moment de sa génération. " +
        "Il ne constitue pas un avis juridique ; les conditions d'utilisation de tout outil mentionné ci-dessus restent la référence à consulter."
      )

    doc.end()
  })
}
