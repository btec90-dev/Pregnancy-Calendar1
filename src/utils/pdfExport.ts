import { jsPDF } from 'jspdf';
import { PregnancyWeekData } from '../weeksData';

export interface PdfAppointment {
  title: string;
  date: string;
  time?: string;
  practitioner?: string;
  completed: boolean;
}

export interface ExportJournalPdfOptions {
  week: number;
  weekData: PregnancyWeekData;
  journalText: string;
  checklists: boolean[];
  appointments?: PdfAppointment[];
}

export function exportJournalToPdf({
  week,
  weekData,
  journalText,
  checklists,
  appointments,
}: ExportJournalPdfOptions): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210
  const pageHeight = doc.internal.pageSize.getHeight(); // 297
  const margin = 16;
  const contentWidth = pageWidth - margin * 2; // 178

  // Cadre décoratif extérieur en laiton/bois
  doc.setDrawColor(184, 143, 91); // #b88f5b
  doc.setLineWidth(1.2);
  doc.rect(margin - 4, margin - 4, contentWidth + 8, pageHeight - (margin - 4) * 2);

  // Filet intérieur fin
  doc.setDrawColor(217, 180, 130);
  doc.setLineWidth(0.4);
  doc.rect(margin - 2, margin - 2, contentWidth + 4, pageHeight - (margin - 2) * 2);

  // Rivets d'angle décoratifs (4 petits cercles aux coins)
  const drawCornerRivet = (cx: number, cy: number) => {
    doc.setFillColor(197, 159, 72); // brass
    doc.circle(cx, cy, 1.2, 'F');
    doc.setDrawColor(88, 60, 19);
    doc.circle(cx, cy, 1.2, 'S');
  };
  drawCornerRivet(margin - 2, margin - 2);
  drawCornerRivet(pageWidth - margin + 2, margin - 2);
  drawCornerRivet(margin - 2, pageHeight - margin + 2);
  drawCornerRivet(pageWidth - margin + 2, pageHeight - margin + 2);

  let currentY = margin + 6;

  // En-tête : RMA of New York
  doc.setFont('times', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110, 75, 40);
  doc.text('RMA OF NEW YORK · LABORATOIRE D\'EMBRYOLOGIE DE MANHATTAN', pageWidth / 2, currentY, {
    align: 'center',
  });
  currentY += 4.5;

  doc.setFontSize(8);
  doc.setTextColor(140, 100, 60);
  doc.text('Protocole Spécialisé FIV / TEC · Suivi Obstétrique Personnalisé', pageWidth / 2, currentY, {
    align: 'center',
  });
  currentY += 6;

  // Ligne de séparation élégante
  doc.setDrawColor(184, 143, 91);
  doc.setLineWidth(0.6);
  doc.line(margin + 20, currentY, pageWidth - margin - 20, currentY);
  currentY += 7;

  // Titre principal
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(74, 44, 16); // #4a2c10
  doc.text('Carnet Intime de Fatou', pageWidth / 2, currentY, { align: 'center' });
  currentY += 6;

  // Sous-titre
  doc.setFont('times', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(115, 68, 20);
  doc.text(
    `Édition Souvenir de Grossesse · Semaine ${week} (${weekData.fruit})`,
    pageWidth / 2,
    currentY,
    { align: 'center' }
  );
  currentY += 9;

  // Bloc résumé télémétrique clinique
  doc.setFillColor(250, 244, 232); // #faf4e8 parchment
  doc.setDrawColor(215, 195, 157);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, currentY, contentWidth, 34, 3, 3, 'FD');

  const infoY = currentY + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 50, 15);

  doc.text('• Protocole Médical :', margin + 5, infoY);
  doc.setFont('helvetica', 'normal');
  doc.text('FET J5 Euploïde Garçon (46, XY · Grade AA)', margin + 38, infoY);

  doc.setFont('helvetica', 'bold');
  doc.text('• DDR Médicale :', margin + 5, infoY + 6);
  doc.setFont('helvetica', 'normal');
  doc.text('15 Octobre 2026', margin + 38, infoY + 6);

  doc.setFont('helvetica', 'bold');
  doc.text('• Date de Transfert :', margin + 5, infoY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text('05 Novembre 2026', margin + 38, infoY + 12);

  doc.setFont('helvetica', 'bold');
  doc.text('• DPA Estimée :', margin + 5, infoY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text('22 Juillet 2027 (Terme)', margin + 38, infoY + 18);

  // Colonne droite du bloc
  const rightColX = margin + contentWidth / 2 + 5;
  doc.setFont('helvetica', 'bold');
  doc.text('• Étape Actuelle :', rightColX, infoY);
  doc.setFont('helvetica', 'normal');
  doc.text(`Semaine ${week} / 40 (${weekData.fruit})`, rightColX + 32, infoY);

  doc.setFont('helvetica', 'bold');
  doc.text('• Biométrie Fœtale :', rightColX, infoY + 6);
  doc.setFont('helvetica', 'normal');
  doc.text(weekData.metrics, rightColX + 32, infoY + 6);

  doc.setFont('helvetica', 'bold');
  doc.text('• Cœur Fœtal :', rightColX, infoY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${weekData.heartRate || 158} bpm`, rightColX + 32, infoY + 12);

  doc.setFont('helvetica', 'bold');
  doc.text('• Centre Clinique :', rightColX, infoY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text('RMA of New York (Manhattan)', rightColX + 32, infoY + 18);

  currentY += 41;

  // Section : Engagements Cliniques & Progression
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(74, 44, 16);
  doc.text('Engagements Cliniques Validés', margin, currentY);
  currentY += 5;

  const checklistItems = [
    'Validation du protocole FET & confirmation garçon euploïde (46, XY).',
    'Transfert blastocyste J5 sous contrôle échographique.',
    'Bêta-hCG sériés confirmant une cinétique vigoureuse.',
    'Échographie du premier trimestre (Clarté nucale à S12).',
  ];

  checklistItems.forEach((item, idx) => {
    const isDone = checklists[idx] ?? false;
    doc.setFont('helvetica', isDone ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(isDone ? 20 : 120, isDone ? 100 : 120, isDone ? 40 : 120);

    const mark = isDone ? '[X]' : '[  ]';
    doc.text(`${mark}  ${item}`, margin + 3, currentY);
    currentY += 4.5;
  });

  if (appointments && appointments.length > 0) {
    currentY += 2;
    doc.setFont('times', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(74, 44, 16);
    doc.text('Prochains Rendez-vous Médicaux Enregistrés :', margin, currentY);
    currentY += 4;

    const topApts = appointments.slice(0, 3);
    topApts.forEach((apt) => {
      doc.setFont('helvetica', apt.completed ? 'normal' : 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(apt.completed ? 120 : 50, apt.completed ? 120 : 35, apt.completed ? 120 : 20);
      const status = apt.completed ? '[Effectué]' : '[Prévu]';
      const timeStr = apt.time ? ` à ${apt.time}` : '';
      const docStr = apt.practitioner ? ` (${apt.practitioner})` : '';
      doc.text(`${status} ${apt.date}${timeStr} : ${apt.title}${docStr}`, margin + 3, currentY);
      currentY += 4;
    });
  }

  currentY += 3;

  // Section : Notes & Pensées Personnelles de Fatou
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(74, 44, 16);
  doc.text('Notes & Pensées Personnelles de la Maman', margin, currentY);
  currentY += 4.5;

  const userNotes = journalText.trim()
    ? journalText.trim()
    : 'Aucune note manuscrite rédigée pour le moment dans le carnet de bord. Cet espace précieux est dédié aux sensations, mots doux et souvenirs de votre grossesse.';

  const splitNotes = doc.splitTextToSize(userNotes, contentWidth - 10);
  const noteBoxHeight = Math.max(45, splitNotes.length * 5 + 12);

  // Vérifier si la boîte dépasse de la page
  if (currentY + noteBoxHeight > pageHeight - 25) {
    // Si c'est trop grand, ajuster ou découper
    const maxFirstPageHeight = pageHeight - currentY - 26;
    doc.setFillColor(255, 252, 246);
    doc.setDrawColor(200, 175, 135);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, currentY, contentWidth, maxFirstPageHeight, 3, 3, 'FD');

    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(45, 25, 8);
    doc.text(splitNotes, margin + 5, currentY + 7);

    // Page supplémentaire
    doc.addPage();
    // Reprendre la suite si besoin
    doc.text('(Suite du carnet)', margin, margin + 10);
  } else {
    doc.setFillColor(255, 252, 246);
    doc.setDrawColor(200, 175, 135);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, currentY, contentWidth, noteBoxHeight, 3, 3, 'FD');

    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(45, 25, 8);
    doc.text(splitNotes, margin + 5, currentY + 7);

    currentY += noteBoxHeight + 6;
  }

  // Petit mot d'inspiration pour le bébé
  if (currentY < pageHeight - 35) {
    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(130, 85, 30);
    doc.text(
      `"Conseil de la Semaine ${week} : ${weekData.advice}"`,
      pageWidth / 2,
      pageHeight - 22,
      { align: 'center', maxWidth: contentWidth }
    );
  }

  // Pied de page élégant
  const exportDateStr = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  doc.setDrawColor(184, 143, 91);
  doc.setLineWidth(0.4);
  doc.line(margin + 10, pageHeight - 16, pageWidth - margin - 10, pageHeight - 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(130, 100, 70);
  doc.text(`Document Souvenir édité le ${exportDateStr}`, margin + 5, pageHeight - 11);
  doc.text('Pregnancy Calendar · Fatou · RMA of New York', pageWidth - margin - 5, pageHeight - 11, {
    align: 'right',
  });

  // Sauvegarde directe du fichier PDF
  const filename = `carnet-intime-fatou-semaine-${week}.pdf`;
  doc.save(filename);
}
