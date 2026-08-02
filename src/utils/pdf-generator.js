// utils/pdf-generator.js - ES Module version
import PDFDocument from 'pdfkit';

/**
 * Generate a professional PDF resume from structured data
 */
export async function generateResumePDF(resumeData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const { personalInfo } = resumeData;
      
      // Header
      if (personalInfo.name) {
        doc.fontSize(24).font('Helvetica-Bold').text(personalInfo.name, { align: 'center' });
        doc.moveDown(0.5);
      }

      // Contact info
      const contactInfo = [];
      if (personalInfo.email) contactInfo.push(personalInfo.email);
      if (personalInfo.phone) contactInfo.push(personalInfo.phone);
      if (personalInfo.location) contactInfo.push(personalInfo.location);
      
      if (contactInfo.length > 0) {
        doc.fontSize(10).font('Helvetica').text(contactInfo.join(' • '), { align: 'center' });
        doc.moveDown(1);
      }

      // Divider
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // Education
      if (resumeData.education && resumeData.education.length > 0) {
        addSection(doc, 'EDUCATION');
        
        resumeData.education.forEach((edu, index) => {
          if (index > 0) doc.moveDown(0.5);
          
          doc.fontSize(12).font('Helvetica-Bold').text(edu.school || '');
          
          const degreeInfo = [];
          if (edu.degree) degreeInfo.push(edu.degree);
          if (edu.field) degreeInfo.push(edu.field);
          
          if (degreeInfo.length > 0) {
            doc.fontSize(11).font('Helvetica').text(degreeInfo.join(' in '));
          }
          
          if (edu.graduationYear) {
            doc.fontSize(10).font('Helvetica-Oblique').text(`Graduated: ${edu.graduationYear}`);
          }
        });
        
        doc.moveDown(1);
      }

      // Experience
      if (resumeData.experience && resumeData.experience.length > 0) {
        addSection(doc, 'EXPERIENCE');
        
        resumeData.experience.forEach((exp, index) => {
          if (index > 0) doc.moveDown(0.8);
          
          if (exp.position) {
            doc.fontSize(12).font('Helvetica-Bold').text(exp.position);
          }
          
          const companyInfo = [];
          if (exp.company) companyInfo.push(exp.company);
          if (exp.duration) companyInfo.push(exp.duration);
          
          if (companyInfo.length > 0) {
            doc.fontSize(11).font('Helvetica-Oblique').text(companyInfo.join(' • '));
          }
          
          if (exp.responsibilities && exp.responsibilities.length > 0) {
            doc.moveDown(0.3);
            exp.responsibilities.forEach(resp => {
              doc.fontSize(10).font('Helvetica').text('• ' + resp, {
                indent: 20,
                paragraphGap: 3
              });
            });
          }
        });
        
        doc.moveDown(1);
      }

      // Skills
      if (resumeData.skills && resumeData.skills.length > 0) {
        addSection(doc, 'SKILLS');
        
        doc.fontSize(10).font('Helvetica').text(resumeData.skills.join(' • '), {
          align: 'left',
          width: 495
        });
        
        doc.moveDown(1);
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

function addSection(doc, title) {
  doc.fontSize(14).font('Helvetica-Bold').text(title);
  
  const titleWidth = doc.widthOfString(title);
  doc.moveTo(50, doc.y + 2)
     .lineTo(50 + titleWidth, doc.y + 2)
     .lineWidth(1.5)
     .stroke();
  
  doc.moveDown(0.5);
}