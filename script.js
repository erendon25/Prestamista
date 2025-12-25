let loans = [];
let movimientos = [];
let currentFilter = 'todos';
let currentTenantCode = null;
let currentModalLoanId = null;
let currentRenderModalContent = null;

const auth = window.auth;
const db = window.db;

// Carga inicial para evitar errores
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('loan-form')) {
    document.getElementById('loan-form').style.display = 'none';
  }
  if (document.getElementById('loans-list')) {
    document.getElementById('loans-list').innerHTML = '<li style="text-align:center;padding:20px;color:#666;">Cargando datos...</li>';
  }
  if (document.querySelector('.summary')) {
    document.querySelector('.summary').style.opacity = '0.5';
  }
});

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || !userDoc.data().tenantCode) {
      window.location.replace('login.html');
      return;
    }

    const data = userDoc.data();
    if (data.tenantCode === 'SUPERADMIN' || data.role === 'superadmin') {
      window.location.replace('superadmin.html');
      return;
    }

    currentTenantCode = data.tenantCode;

    document.getElementById('loan-form').style.display = 'grid';
    document.querySelector('.summary').style.opacity = '1';

    setupRealtimeListeners();
    updateSummary();
    setupEventListeners();

  } catch (error) {
    console.error('Error al cargar usuario:', error);
    alert('Error de conexión. Redirigiendo al login.');
    window.location.replace('login.html');
  }
});

function getLoansCollection() {
  if (!currentTenantCode) throw new Error("Tenant no definido");
  return db.collection('tenants').doc(currentTenantCode).collection('loans');
}

function getMovimientosCollection() {
  if (!currentTenantCode) throw new Error("Tenant no definido");
  return db.collection('tenants').doc(currentTenantCode).collection('movimientos');
}

function setupRealtimeListeners() {
  getLoansCollection().onSnapshot(snapshot => {
    loans = [];
    snapshot.forEach(doc => loans.push({ id: doc.id, ...doc.data() }));
    renderLoans();
    updateSummary();
  });

  getMovimientosCollection().orderBy('timestamp', 'desc').onSnapshot(snapshot => {
    movimientos = [];
    snapshot.forEach(doc => movimientos.push({ id: doc.id, ...doc.data() }));
    if (document.getElementById('history-modal')?.style.display === 'block') {
      renderHistory();
    }
    updateSummary();
  });
}

function getStatusAndMora(loan) {
  const capital = parseFloat(loan.capital || 0);
  const interesPorcentaje = parseFloat(loan.interes || 0);
  const plazoDias = parseInt(loan.plazoDias || 1);

  const interesTotal = capital * (interesPorcentaje / 100);
  const deudaTotal = capital + interesTotal;
  const cuotaDiaria = deudaTotal / plazoDias;

  const pagosTotal = (loan.pagos || []).reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
  const cuotasPagadas = Math.floor(pagosTotal / cuotaDiaria);
  const saldoPendiente = Math.max(0, deudaTotal - pagosTotal);

  const startDate = new Date(loan.fecha);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + plazoDias);
  const today = new Date();
  const daysElapsed = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));

  let moraAcumulada = 0;
  if (loan.mora > 0 && daysElapsed > plazoDias) {
    const diasMora = daysElapsed - plazoDias;
    moraAcumulada = saldoPendiente * (loan.mora / 100) * diasMora;
  }

  let status = 'verde';
  if (daysElapsed >= plazoDias - 2 && daysElapsed < plazoDias) status = 'amarillo';
  if (daysElapsed >= plazoDias) status = 'rojo';

  const prestamoFinalizado = cuotasPagadas >= plazoDias || saldoPendiente <= 0.01;

  return {
    status,
    cuotaDiaria,
    cuotasPagadas,
    cuotasTotales: plazoDias,
    deudaTotal,
    saldoPendiente: saldoPendiente + moraAcumulada,
    moraAcumulada,
    endDate,
    prestamoFinalizado
  };
}

function formatDate(date) {
  return date ? new Date(date).toLocaleDateString('es-PE') : 'No registrada';
}

function formatDateTime(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date(ts || Date.now());
  return date.toLocaleDateString('es-PE') + ' ' + date.toLocaleTimeString('es-PE');
}

function renderLoans() {
  const searchTerm = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  let filtered = loans.filter(loan => {
    if (currentFilter !== 'todos') {
      const map = { 'activos': 'verde', 'por-vencer': 'amarillo', 'vencidos': 'rojo' };
      if (getStatusAndMora(loan).status !== map[currentFilter]) return false;
    }
    if (searchTerm) {
      return loan.nombre.toLowerCase().includes(searchTerm) ||
             (loan.telefono && loan.telefono.includes(searchTerm)) ||
             (loan.notas && loan.notas.toLowerCase().includes(searchTerm));
    }
    return true;
  });

  const list = document.getElementById('loans-list');
  if (!list) return;
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#666;padding:20px;">No hay préstamos que coincidan.</li>';
    return;
  }

  filtered.forEach(loan => {
    const info = getStatusAndMora(loan);

    const li = document.createElement('li');
    li.className = `loan-item status-${info.status}`;
    li.style.cursor = 'pointer';

    li.addEventListener('click', (e) => {
      if (!e.target.closest('.actions button')) {
        openModal(loan.id);
      }
    });

    li.innerHTML = `
      <div class="loan-summary">
        <strong>${loan.nombre}</strong> - Tel: ${loan.telefono || 'No registrado'}<br>
        Saldo Pendiente: S/${info.saldoPendiente.toFixed(2)} | Cuota diaria: S/${info.cuotaDiaria.toFixed(2)}<br>
        Pagado: ${info.cuotasPagadas} de ${info.cuotasTotales} cuotas<br>
        Vence: ${formatDate(info.endDate)}
      </div>
      <div class="actions">
        <button class="details-btn">Detalles</button>
        <button class="edit-btn">Editar</button>
        <button class="delete-btn">Eliminar</button>
      </div>
    `;

    li.querySelector('.details-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(loan.id);
    });

    li.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(loan.id);
    });

    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLoan(loan.id);
    });

    list.appendChild(li);
  });
}

function updateSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let capitalActivo = 0;
  let cobradoHoy = 0;
  let cobroEsperadoHoy = 0;
  let totalPorCobrar = 0;
  let prestamosActivos = 0;

  loans.forEach(loan => {
    const info = getStatusAndMora(loan);
    if (!info.prestamoFinalizado) {
      capitalActivo += parseFloat(loan.capital);
      totalPorCobrar += info.saldoPendiente;
      prestamosActivos++;

      // Cuota diaria esperada (independiente de mora)
      const diasTranscurridos = Math.floor((today - new Date(loan.fecha)) / (86400000));
      if (diasTranscurridos >= 0 && diasTranscurridos < loan.plazoDias && !info.prestamoFinalizado) {
        cobroEsperadoHoy += info.cuotaDiaria;
      }
    }
  });

  movimientos.forEach(mov => {
    const movDate = mov.timestamp?.toDate() || new Date();
    if (mov.tipo === 'pago' && movDate.toDateString() === today.toDateString()) {
      cobradoHoy += parseFloat(mov.monto);
    }
  });

  // Restar gastos del cobrado hoy
  movimientos.forEach(mov => {
    const movDate = mov.timestamp?.toDate() || new Date();
    if (mov.tipo === 'gasto' && movDate.toDateString() === today.toDateString()) {
      cobradoHoy -= parseFloat(mov.monto);
    }
  });

  document.getElementById('capital-activo').textContent = capitalActivo.toFixed(2);
  document.getElementById('cobrado-hoy').textContent = Math.max(0, cobradoHoy).toFixed(2);
  document.getElementById('cobro-esperado-hoy').textContent = cobroEsperadoHoy.toFixed(2);
  document.getElementById('total-por-cobrar').textContent = totalPorCobrar.toFixed(2);
  document.getElementById('prestamos-activos').textContent = prestamosActivos;
}

function generateReceiptPDF(loanId, paymentIndex) {
  const loan = loans.find(l => l.id === loanId);
  if (!loan || !loan.pagos || paymentIndex >= loan.pagos.length) return;

  const pago = loan.pagos[paymentIndex];
  const info = getStatusAndMora(loan);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.text('RECIBO DE PAGO', 105, 20, { align: 'center' });

  doc.setFontSize(12);
  doc.text(`Cliente: ${loan.nombre}`, 20, 40);
  doc.text(`Teléfono: ${loan.telefono || 'No registrado'}`, 20, 50);
  doc.text(`Capital original: S/${loan.capital.toFixed(2)}`, 20, 60);
  doc.text(`Interés total: S/${(loan.capital * loan.interes / 100).toFixed(2)}`, 20, 70);
  doc.text(`Deuda total: S/${info.deudaTotal.toFixed(2)}`, 20, 80);

  doc.setFontSize(14);
  doc.text('DETALLE DEL PAGO', 20, 100);
  doc.setFontSize(12);
  doc.text(`Fecha: ${formatDateTime(pago.timestamp)}`, 20, 110);
  doc.text(`Monto pagado: S/${pago.monto.toFixed(2)}`, 20, 120);
  doc.text(`Cuota número: ${paymentIndex + 1} de ${info.cuotasTotales}`, 20, 130);

  doc.text(`Saldo pendiente: S/${info.saldoPendiente.toFixed(2)}`, 20, 150);

  doc.setFontSize(10);
  doc.text(`Generado el ${new Date().toLocaleDateString('es-PE')} a las ${new Date().toLocaleTimeString('es-PE')}`, 20, 280);

  doc.save(`recibo_${loan.nombre.replace(/\s+/g, '_')}_cuota_${paymentIndex + 1}.pdf`);
}

function openModal(loanId) {
  currentModalLoanId = loanId;

  const modalBody = document.getElementById('modal-body');

  const renderModalContent = () => {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) {
      modalBody.innerHTML = '<p>Préstamo no encontrado.</p>';
      return;
    }

    const info = getStatusAndMora(loan);

    modalBody.innerHTML = `
      <p><strong>Nombre:</strong> ${loan.nombre}</p>
      <p><strong>Teléfono:</strong> ${loan.telefono || 'No registrado'}</p>
      <p><strong>Capital:</strong> S/${loan.capital.toFixed(2)}</p>
      <p><strong>Interés total (${loan.interes}%):</strong> S/${(loan.capital * loan.interes / 100).toFixed(2)}</p>
      <p><strong>Deuda total:</strong> S/${info.deudaTotal.toFixed(2)}</p>
      <p><strong>Cuota diaria:</strong> S/${info.cuotaDiaria.toFixed(2)}</p>
      <p><strong>Cuotas pagadas:</strong> ${info.cuotasPagadas} de ${info.cuotasTotales}</p>
      <p><strong>Saldo pendiente:</strong> <strong style="color:#dc3545;font-size:1.4em;">S/${info.saldoPendiente.toFixed(2)}</strong></p>
      ${info.moraAcumulada > 0 ? `<p><strong>Mora acumulada:</strong> S/${info.moraAcumulada.toFixed(2)}</p>` : ''}
      <hr>
      ${!info.prestamoFinalizado ? `
        <h4>Registrar Pago</h4>
        <div style="display:flex;gap:10px;margin-bottom:20px;">
          <input type="number" id="payment-input" value="${info.cuotaDiaria.toFixed(2)}" step="0.01" style="flex:1;padding:12px;font-size:16px;">
          <button id="register-payment" style="padding:12px 20px;background:#28a745;color:white;border:none;border-radius:8px;cursor:pointer;">Registrar Cuota</button>
        </div>
        <hr>
        <button id="renew-loan" style="width:100%;padding:15px;background:#007bff;color:white;border:none;border-radius:8px;margin-top:10px;">Renovar con Saldo Pendiente</button>
      ` : '<p style="color:#28a745;font-weight:bold;text-align:center;">Préstamo saldado completamente</p>'}
      <h4>Historial de Pagos</h4>
      <div id="payment-history-container" style="max-height:200px;overflow-y:auto;background:#f9f9f9;padding:10px;border-radius:8px;">
        ${(loan.pagos || []).length > 0 ? (loan.pagos || []).map((p, idx) => `
          <div class="payment-item" data-index="${idx}" style="background:white;padding:10px;margin:5px 0;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.1);position:relative;">
            <span class="delete-payment-icon" style="position:absolute;top:8px;right:10px;font-size:1.2em;cursor:pointer;">🗑️</span>
            <span class="pdf-icon" style="position:absolute;top:8px;right:40px;font-size:1.2em;cursor:pointer;">📄</span>
            ${formatDateTime(p.timestamp)} - <strong>S/${parseFloat(p.monto).toFixed(2)}</strong>
          </div>
        `).join('') : '<div style="text-align:center;color:#666;padding:20px;">No hay pagos registrados</div>'}
      </div>
      <hr>
      <p><strong>Notas:</strong> ${loan.notas || 'Ninguna'}</p>
    `;

    if (!info.prestamoFinalizado) {
      document.getElementById('register-payment').onclick = async () => {
  const montoInput = document.getElementById('payment-amount');
  const monto = parseFloat(montoInput.value);
  if (isNaN(monto) || monto <= 0) {
    alert('Ingresa un monto válido');
    return;
  }
  if (monto > info.saldoPendiente) {
    alert(`El monto no puede exceder el saldo pendiente (S/${info.saldoPendiente.toFixed(2)})`);
    return;
  }

        const clientTimestamp = new Date();

        try {
          const movRef = await getMovimientosCollection().add({
            tipo: 'pago',
            monto,
            loanId,
            nombre: loan.nombre,
            timestamp: firebase.firestore.Timestamp.fromDate(clientTimestamp)
          });

          const nuevosPagos = [...(loan.pagos || []), {
            monto,
            timestamp: clientTimestamp,
            movimientoId: movRef.id
          }];

          await getLoansCollection().doc(loanId).update({ pagos: nuevosPagos });

          loan.pagos = nuevosPagos;
          renderModalContent();

          alert('Cuota registrada correctamente');
        } catch (error) {
          console.error('Error registrando pago:', error);
          alert('Error al registrar la cuota');
        }
      };
    }

    document.querySelectorAll('.payment-item .delete-payment-icon').forEach(icon => {
      icon.onclick = (e) => {
        e.stopPropagation();
        const index = parseInt(icon.parentElement.dataset.index);
        deletePago(loanId, index);
      };
    });

    document.querySelectorAll('.payment-item .pdf-icon').forEach(icon => {
      icon.onclick = (e) => {
        e.stopPropagation();
        const index = parseInt(icon.parentElement.dataset.index);
        generateReceiptPDF(loanId, index);
      };
    });
  };

  currentRenderModalContent = renderModalContent;
  renderModalContent();
  document.getElementById('modal').style.display = 'block';
}

async function deletePago(loanId, paymentIndex) {
  if (!confirm('¿Estás seguro de eliminar este pago? Esto revertirá el contador de cuotas, aumentará el saldo pendiente y eliminará el movimiento del historial general.')) {
    return;
  }

  try {
    const loanDoc = await getLoansCollection().doc(loanId).get();
    if (!loanDoc.exists) return;

    const loanData = loanDoc.data();
    const pagos = loanData.pagos || [];

    if (paymentIndex < 0 || paymentIndex >= pagos.length) return;

    const pagoEliminado = pagos[paymentIndex];
    const movimientoId = pagoEliminado.movimientoId;

    pagos.splice(paymentIndex, 1);

    await getLoansCollection().doc(loanId).update({ pagos });

    const loanLocal = loans.find(l => l.id === loanId);
    if (loanLocal) loanLocal.pagos = pagos;

    if (movimientoId) {
      await getMovimientosCollection().doc(movimientoId).delete();
    }

    renderLoans();
    updateSummary();

    if (currentModalLoanId === loanId && currentRenderModalContent) {
      currentRenderModalContent();
    }

    if (document.getElementById('history-modal')?.style.display === 'block') {
      renderHistory();
    }

    alert('Pago eliminado correctamente.');
  } catch (error) {
    console.error('Error eliminando pago:', error);
    alert('Error al eliminar el pago.');
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '';

  if (movimientos.length === 0) {
    list.innerHTML = '<li style="text-align:center;padding:20px;color:#666;">No hay movimientos registrados.</li>';
    return;
  }

  movimientos.forEach(mov => {
    const date = mov.timestamp?.toDate?.() || new Date();

    const li = document.createElement('li');
    li.style.cssText = 'background:white;padding:15px;margin:10px 0;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);position:relative;';

    const content = document.createElement('div');
    content.style.paddingRight = '50px';
    content.innerHTML = `
      <strong>${date.toLocaleDateString('es-PE')} ${date.toLocaleTimeString('es-PE')}</strong><br>
      ${mov.tipo === 'pago' ? '🟢 <strong>Pago recibido</strong>' : '🔴 <strong>Gasto</strong>'} de <strong>S/${parseFloat(mov.monto).toFixed(2)}</strong><br>
      ${mov.tipo === 'pago' ? `De: <em>${mov.nombre || 'Préstamo'}</em>` : `Motivo: <em>${mov.motivo}</em>`}
    `;
    li.appendChild(content);

    // Icono de eliminación solo para gastos (los pagos se eliminan desde el detalle del préstamo)
    if (mov.tipo === 'gasto') {
      const deleteIcon = document.createElement('span');
      deleteIcon.innerHTML = '🗑️';
      deleteIcon.style.cssText = 'position:absolute;top:10px;right:15px;font-size:1.4em;cursor:pointer;opacity:0.7;transition:opacity 0.2s;';
      deleteIcon.addEventListener('mouseover', () => deleteIcon.style.opacity = '1');
      deleteIcon.addEventListener('mouseout', () => deleteIcon.style.opacity = '0.7');
      deleteIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMovimientoGasto(mov.id);
      });
      li.appendChild(deleteIcon);
    }

    list.appendChild(li);
  });
}

async function deleteMovimientoGasto(movId) {
  if (confirm('¿Estás seguro de eliminar este gasto?')) {
    try {
      await getMovimientosCollection().doc(movId).delete();
      alert('Gasto eliminado correctamente.');
    } catch (error) {
      console.error('Error eliminando gasto:', error);
      alert('Error al eliminar el gasto.');
    }
  }
}

async function deleteLoan(loanId) {
  if (confirm('¿Eliminar este préstamo permanentemente?')) {
    try {
      await getLoansCollection().doc(loanId).delete();
    } catch (error) {
      console.error('Error eliminando préstamo:', error);
      alert('Error al eliminar el préstamo.');
    }
  }
}

function openEditModal(loanId) {
  const loan = loans.find(l => l.id === loanId);
  if (!loan) return;

  document.getElementById('edit-index').value = loanId;
  document.getElementById('edit-nombre').value = loan.nombre;
  document.getElementById('edit-telefono').value = loan.telefono || '';
  document.getElementById('edit-capital').value = loan.capital;
  document.getElementById('edit-interes').value = loan.interes;
  document.getElementById('edit-mora').value = loan.mora || 0;
  document.getElementById('edit-plazo').value = loan.plazoDias;
  document.getElementById('edit-fecha').value = loan.fecha;
  document.getElementById('edit-notas').value = loan.notas || '';
  document.getElementById('edit-modal').style.display = 'block';
}

function setupEventListeners() {
  document.getElementById('loan-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const loan = {
      nombre: document.getElementById('nombre').value.trim(),
      telefono: document.getElementById('telefono').value.replace(/\D/g, '').trim() || null,
      capital: parseFloat(document.getElementById('capital').value),
      interes: parseFloat(document.getElementById('interes').value),
      mora: parseFloat(document.getElementById('mora').value) || 0,
      plazoDias: parseInt(document.getElementById('plazo-dias').value),
      fecha: document.getElementById('fecha').value || new Date().toISOString().slice(0, 10),
      notas: document.getElementById('notas').value.trim(),
      pagos: [],
      renovado: false
    };
    await getLoansCollection().add(loan);
    e.target.reset();
  });

  document.getElementById('add-expense-btn')?.addEventListener('click', () => {
    document.getElementById('expense-modal').style.display = 'block';
  });

  document.getElementById('save-expense')?.addEventListener('click', async () => {
    const motivo = document.getElementById('expense-motive').value.trim();
    const monto = parseFloat(document.getElementById('expense-amount').value);
    if (motivo && monto > 0) {
      await getMovimientosCollection().add({
        tipo: 'gasto',
        monto,
        motivo,
        timestamp: firebase.firestore.Timestamp.now()
      });
      document.getElementById('expense-modal').style.display = 'none';
      document.getElementById('expense-motive').value = '';
      document.getElementById('expense-amount').value = '';
    } else {
      alert('Completa motivo y monto');
    }
  });
  
  document.getElementById('history-btn')?.addEventListener('click', () => {
    renderHistory();
    document.getElementById('history-modal').style.display = 'block';
  });

  document.querySelectorAll('.close, .close-edit, .close-expense, .close-history').forEach(el => {
    el.onclick = () => el.closest('.modal').style.display = 'none';
  });

  window.onclick = e => {
    if (e.target.classList.contains('modal')) e.target.style.display = 'none';
  };

  document.getElementById('search-input')?.addEventListener('keyup', renderLoans);

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (confirm('¿Cerrar sesión?')) {
      await auth.signOut();
      window.location.replace('login.html');
    }
  });
}