import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface AgreementPdfInput {
  applicationId: string;
  listingTitle: string;
  propertyAddress: string;
  landlordName: string;
  tenantName: string;
  tenantEmail: string | null;
  tenantPhone: string | null;
  rentAmount: string | null;
  depositAmount: string | null;
  currency: string;
  leaseTerm: string | null;
  moveInDate: Date | null;
  signature: string;
  signatureType: 'TYPED' | 'DRAWN';
  tenantSignedAt: Date;
  approvedAt: Date;
}

const DISCLAIMER =
  'ComLinkr is a platform facilitating connections between landlords and tenants. ' +
  'ComLinkr is NOT a legal party to this agreement and is NOT responsible for enforcing its terms. ' +
  'This template is provided for convenience only. Both parties are strongly advised to consult ' +
  'a licensed attorney before signing.';

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : 'To be agreed';
}

function formatMoney(amount: string | null, currency: string): string {
  return amount === null ? 'Not specified' : `${amount} ${currency}`;
}

/** Decodes a drawn signature (raw base64 or a data: URI) into image bytes. */
export function decodeSignatureImage(signature: string): Buffer | null {
  const base64 = signature.replace(/^data:image\/(png|jpe?g);base64,/i, '');
  const buffer = Buffer.from(base64, 'base64');
  const isPng = buffer.length > 4 && buffer.readUInt32BE(0) === 0x89504e47;
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  return isPng || isJpeg ? buffer : null;
}

@Injectable()
export class AgreementPdfService {
  private readonly logger = new Logger(AgreementPdfService.name);

  render(input: AgreementPdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).font('Helvetica-Bold').text('Tenancy Agreement', {
        align: 'center',
      });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#555555')
        .text(`Reference: ${input.applicationId}`, { align: 'center' });
      doc.fillColor('#000000').moveDown(1.5);

      const section = (title: string, rows: Array<[string, string]>) => {
        doc.fontSize(12).font('Helvetica-Bold').text(title);
        doc.moveDown(0.4);
        doc.fontSize(10).font('Helvetica');
        for (const [label, value] of rows) {
          doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
          doc.font('Helvetica').text(value);
        }
        doc.moveDown(1);
      };

      section('Parties', [
        ['Landlord', input.landlordName],
        ['Tenant', input.tenantName],
        ['Tenant email', input.tenantEmail ?? 'Not provided'],
        ['Tenant phone', input.tenantPhone ?? 'Not provided'],
      ]);
      section('Property', [
        ['Listing', input.listingTitle],
        ['Address', input.propertyAddress],
      ]);
      section('Terms', [
        ['Monthly rent', formatMoney(input.rentAmount, input.currency)],
        ['Security deposit', formatMoney(input.depositAmount, input.currency)],
        ['Lease term', input.leaseTerm ?? 'To be agreed'],
        ['Move-in date', formatDate(input.moveInDate)],
      ]);

      doc.fontSize(12).font('Helvetica-Bold').text('Signatures');
      doc.moveDown(0.4);
      doc.fontSize(10).font('Helvetica').text('Tenant signature:');
      doc.moveDown(0.3);
      if (input.signatureType === 'DRAWN') {
        const image = decodeSignatureImage(input.signature);
        if (image) {
          try {
            doc.image(image, { fit: [200, 70] });
          } catch (error) {
            this.logger.warn(
              `Could not embed drawn signature for ${input.applicationId}: ${(error as Error).message}`,
            );
            doc.text('[Drawn signature on file]');
          }
        } else {
          doc.text('[Drawn signature on file]');
        }
      } else {
        doc.fontSize(16).font('Times-Italic').text(input.signature);
      }
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Signed by the tenant on ${input.tenantSignedAt.toISOString()}`);
      doc.moveDown(0.6);
      doc.text(
        `Approved by the landlord (${input.landlordName}) on ${input.approvedAt.toISOString()}`,
      );
      doc.moveDown(2);

      doc
        .fontSize(8)
        .fillColor('#555555')
        .text('IMPORTANT DISCLAIMER', { underline: true })
        .moveDown(0.3)
        .text(DISCLAIMER);

      doc.end();
    });
  }
}
