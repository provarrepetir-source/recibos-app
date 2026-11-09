const { validNif } = require('./sheet');

// Cruza grupos do PDF com a folha. status: ok | bloqueado (com motivos) — nunca envia se houver dúvida.
function matchGroups(groups, employees) {
  return groups.map(g => {
    const e = employees.get(g.id);
    const issues = [];
    if (!e) issues.push('Id não existe na folha');
    else {
      if (!e.phone) issues.push('Telemóvel em falta ou inválido');
      if (!e.nif) issues.push('NIF em falta na folha');
      else if (!validNif(e.nif)) issues.push('NIF inválido na folha');
      if (g.nifs.length > 1) issues.push('Páginas do mesmo Id com NIFs diferentes');
      if (e.nif && g.nifs.length && !g.nifs.includes(e.nif)) issues.push('NIF da folha difere do NIF do recibo');
    }
    return { id: g.id, nomePdf: g.name, nome: e?.nome || g.name, pages: g.pages, phone: e?.phone || null,
             nif: e?.nif || null, status: issues.length ? 'bloqueado' : 'ok', issues };
  });
}
module.exports = { matchGroups };
