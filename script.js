let loans = [];
let movimientos = [];
let currentFilter = 'todos';
let currentTenantCode = null;

const auth = window.auth;
const db = window.db;

// Carga inicial
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

// Manejo de autenticación
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  try {
    const userDocRef = db.collection('users').doc(user.uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      window.location.replace('login.html');
      return;
    }

    const data = userDoc.data();
    if (!data || !data.tenantCode) {
      window.location.replace('login.html');
      return;
    }

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
    alert('Error de conexión o acceso denegado. Por favor, intente iniciar sesión nuevamente.');
    await auth.signOut();
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

function getStatusAndSaldo(loan) {
  const capital = parseFloat(loan.capital || 0);
  const interesPorcentaje = parseFloat(loan.interes || 0);
  const cantidadPeriodos = parseInt(loan.cantidadPeriodos || 1);

  const interesTotal = capital * (interesPorcentaje / 100);
  const deudaTotal = capital + interesTotal;
  const cuotaPorPeriodo = deudaTotal / cantidadPeriodos;

  const pagosTotal = (loan.pagos || []).reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
  const saldoPendiente = Math.max(0, deudaTotal - pagosTotal);

  const cuotasPagadas = Math.floor(pagosTotal / cuotaPorPeriodo);
  const cuotasTotales = cantidadPeriodos;

  const startDate = new Date(loan.fecha);
  const today = new Date();
  const daysElapsed = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));

  const plazoDias = loan.plazoDias || cantidadPeriodos;

  let status = 'verde';
  if (daysElapsed >= plazoDias - 2 && daysElapsed < plazoDias) status = 'amarillo';
  if (daysElapsed >= plazoDias) status = 'rojo';

  const prestamoFinalizado = pagosTotal >= deudaTotal || saldoPendiente <= 0.01;

  return {
    status,
    cuotaPorPeriodo,
    deudaTotal,
    saldoPendiente,
    cuotasPagadas,
    cuotasTotales,
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

function filterLoans(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.filters button[onclick="filterLoans('${filter}')"]`).classList.add('active');
  renderLoans();
}

function renderLoans() {
  const searchTerm = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let filtered = loans.filter(loan => {
    const info = getStatusAndSaldo(loan);
    const diasTranscurridos = Math.floor((today - new Date(loan.fecha)) / 86400000);

    if (currentFilter === 'activos' && info.status !== 'verde') return false;
    if (currentFilter === 'por-vencer' && info.status !== 'amarillo') return false;
    if (currentFilter === 'vencidos' && info.status !== 'rojo') return false;
    if (currentFilter === 'cobrar-hoy') {
      if (diasTranscurridos < 0 || diasTranscurridos >= loan.plazoDias || info.prestamoFinalizado) return false;
    }

    if (searchTerm) {
      return loan.nombre.toLowerCase().includes(searchTerm) ||
             (loan.telefono && loan.telefono.includes(searchTerm)) ||
             (loan.notas && loan.notas.toLowerCase().includes(searchTerm));
    }
    return true;
  });

  const list = document.getElementById('loans-list');
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#666;padding:20px;">No hay préstamos que coincidan.</li>';
    return;
  }

  filtered.forEach(loan => {
    const info = getStatusAndSaldo(loan);

    const li = document.createElement('li');
    li.className = `loan-item status-${info.status}`;
    li.innerHTML = `
      <div class="loan-summary">
        <strong>${loan.nombre}</strong> - Tel: ${loan.telefono || 'No registrado'}<br>
        Saldo Pendiente: S/${info.saldoPendiente.toFixed(2)} | Cuota: S/${info.cuotaPorPeriodo.toFixed(2)}<br>
        Cuotas pagadas: ${info.cuotasPagadas} de ${info.cuotasTotales}<br>
        Vence: ${formatDate(new Date(new Date(loan.fecha).getTime() + loan.plazoDias * 86400000))}
      </div>
      <div class="actions">
        <button class="edit-btn">Editar</button>
        <button class="delete-btn">Eliminar</button>
      </div>
    `;

    li.onclick = (e) => {
      if (e.target.closest('.actions')) return;
      openModal(loan.id);
    };

    li.querySelector('.edit-btn').onclick = (e) => {
      e.stopPropagation();
      openEditModal(loan.id);
    };

    li.querySelector('.delete-btn').onclick = (e) => {
      e.stopPropagation();
      deleteLoan(loan.id);
    };

    list.appendChild(li);
  });
}

function openModal(loanId) {
  const modal = document.getElementById('modal');
  const loan = loans.find(l => l.id === loanId);
  if (!loan) return;

  const info = getStatusAndSaldo(loan);

  document.getElementById('modal-body').innerHTML = `
  <p><strong>Nombre:</strong> ${loan.nombre}</p>
  <p><strong>Teléfono:</strong> ${loan.telefono || 'No registrado'}</p>
  <p><strong>Capital prestado:</strong> S/${parseFloat(loan.capital).toFixed(2)}</p>
  <p><strong>Interés por período:</strong> ${loan.interes}%</p>
  <p><strong>Método de pago:</strong> ${loan.metodoPago.charAt(0).toUpperCase() + loan.metodoPago.slice(1)}</p>
  <p><strong>Total de períodos (cuotas):</strong> ${info.cuotasTotales}</p>
  <p><strong>Cuotas pagadas:</strong> <strong style="color:#28a745;">${info.cuotasPagadas} de ${info.cuotasTotales}</strong></p>
  <p><strong>Fecha de inicio:</strong> ${formatDate(loan.fecha)}</p>
  <p><strong>Notas:</strong> ${loan.notas || 'Ninguna'}</p>
  <p><strong>Saldo pendiente:</strong> S/${info.saldoPendiente.toFixed(2)}</p>
  <p><strong>Cuota por período:</strong> S/${info.cuotaPorPeriodo.toFixed(2)}</p>
  <hr>
  <h3>Registrar Pago</h3>
  <input type="number" id="payment-amount" placeholder="Monto a pagar" step="0.01" value="${info.saldoPendiente > 0 ? info.cuotaPorPeriodo.toFixed(2) : ''}" style="padding:10px; width:100%; box-sizing:border-box; margin-bottom:10px; font-size:16px;" ${info.saldoPendiente <= 0 ? 'disabled' : ''}>
  <button id="register-payment" style="padding:12px 20px; background:#28a745; color:white; border:none; border-radius:8px; width:100%; font-size:16px; cursor:pointer; margin-bottom:10px;" ${info.saldoPendiente <= 0 ? 'disabled' : ''}>Registrar Pago</button>
  <button id="renew-loan" style="padding:12px 20px; background:#ff9800; color:white; border:none; border-radius:8px; width:100%; font-size:16px; cursor:pointer;">Renovar Préstamo</button>
  <h3 style="margin-top:20px;">Historial de pagos</h3>
  <ul id="payment-history" style="list-style:none; padding:0; max-height:300px; overflow-y:auto;"></ul>
`;

  document.getElementById('register-payment').onclick = async () => {
  if (info.saldoPendiente <= 0) {
    alert('El préstamo ya está completamente pagado. No se pueden registrar más pagos.');
    return;
  }

  const montoInput = document.getElementById('payment-amount');
  const monto = parseFloat(montoInput.value);

  if (isNaN(monto) || monto <= 0) {
    alert('Por favor ingrese un monto válido mayor a cero.');
    return;
  }
  if (monto > info.saldoPendiente) {
    alert(`El monto no puede exceder el saldo pendiente: S/${info.saldoPendiente.toFixed(2)}`);
    return;
  }

  try {
    const movimientoRef = await getMovimientosCollection().add({
      tipo: 'pago',
      monto,
      nombre: loan.nombre,
      loanId: loan.id,
      timestamp: firebase.firestore.Timestamp.now()
    });

    const pagos = loan.pagos || [];
    pagos.push({
      monto,
      fecha: new Date().toISOString().slice(0, 10),
      movimientoId: movimientoRef.id
    });

    await getLoansCollection().doc(loan.id).update({ pagos });
    montoInput.value = '';
    openModal(loan.id); // Recargar modal con datos actualizados
  } catch (error) {
    alert('Error al registrar el pago.');
    console.error(error);
  }
};

  document.getElementById('renew-loan').onclick = async () => {
    const nuevoPlazo = prompt('Ingrese el nuevo plazo en períodos:', loan.cantidadPeriodos);
    if (!nuevoPlazo || isNaN(nuevoPlazo) || nuevoPlazo <= 0) {
      alert('Por favor ingrese un número válido de períodos.');
      return;
    }

    try {
      const pagosTotal = (loan.pagos || []).reduce((s, p) => s + parseFloat(p.monto), 0);
      const montoFaltante = parseFloat(loan.capital) - pagosTotal;

      if (montoFaltante > 0) {
        await getMovimientosCollection().add({
          tipo: 'desembolso_renovacion',
          monto: montoFaltante,
          nombre: loan.nombre,
          loanId: loan.id,
          timestamp: firebase.firestore.Timestamp.now()
        });
      }

      await getLoansCollection().doc(loan.id).update({
        fecha: new Date().toISOString().slice(0, 10),
        plazoDias: calcularPlazoDias(loan.metodoPago, parseInt(nuevoPlazo)),
        cantidadPeriodos: parseInt(nuevoPlazo),
        pagos: [],
        renovado: true
      });

      alert('Préstamo renovado exitosamente.');
      modal.style.display = 'none';
    } catch (error) {
      alert('Error al renovar el préstamo.');
      console.error(error);
    }
  };

  const phList = document.getElementById('payment-history');
  phList.innerHTML = '';
  
  if (!loan.pagos || loan.pagos.length === 0) {
    phList.innerHTML = '<li style="text-align:center;padding:20px;color:#666;">No hay pagos registrados.</li>';
  } else {
    (loan.pagos || []).sort((a, b) => {
      const fechaA = a.fecha ? new Date(a.fecha) : new Date(0);
      const fechaB = b.fecha ? new Date(b.fecha) : new Date(0);
      return fechaB - fechaA; // Más recientes primero
    }).forEach((p, i) => {
      const pli = document.createElement('li');
      pli.style.cssText = 'background:white; padding:14px; margin:8px 0; border-radius:8px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 4px rgba(0,0,0,0.1); border:1px solid #e2e8f0;';
      
      const fechaPago = p.fecha ? new Date(p.fecha).toLocaleDateString('es-PE') : 'Fecha no registrada';
      
      pli.innerHTML = `
        <div style="flex:1;">
          <strong style="display:block;margin-bottom:4px;">${fechaPago}</strong>
          <span style="color:#64748b;font-size:0.9em;">Monto: S/${parseFloat(p.monto || 0).toFixed(2)}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="edit-btn" style="padding:8px 16px;font-size:13px;min-width:auto;" title="Generar recibo PDF">
            📄 Recibo
          </button>
          <button class="delete-btn" style="padding:8px 16px;font-size:13px;min-width:auto;" title="Eliminar pago">
            🗑️ Eliminar
          </button>
        </div>
      `;

      // Botón de generar recibo
      const btnRecibo = pli.querySelector('button[title="Generar recibo PDF"]');
      btnRecibo.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        generarReciboPDF(loan, p);
      };

      // Botón de eliminar
      const btnEliminar = pli.querySelector('button[title="Eliminar pago"]');
      btnEliminar.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        deletePayment(loan.id, i, p.movimientoId);
      };

      phList.appendChild(pli);
    });
  }

  modal.style.display = 'block';
}

function openEditModal(loanId) {
  const modal = document.getElementById('edit-modal');
  const loan = loans.find(l => l.id === loanId);
  if (!loan) return;

  document.getElementById('edit-loan-id').value = loan.id;
  document.getElementById('edit-nombre').value = loan.nombre;
  document.getElementById('edit-telefono').value = loan.telefono || '';
  document.getElementById('edit-capital').value = parseFloat(loan.capital).toFixed(2);
  document.getElementById('edit-interes').value = parseFloat(loan.interes).toFixed(2);
  document.getElementById('edit-metodo-pago').value = loan.metodoPago;
  document.getElementById('edit-cantidad-periodos').value = loan.cantidadPeriodos;
  document.getElementById('edit-fecha').value = loan.fecha;
  document.getElementById('edit-notas').value = loan.notas || '';

  modal.style.display = 'block';
}

function generarReciboPDF(loan, pago) {
  try {
    // Verificar que jsPDF esté disponible
    if (!window.jspdf) {
      alert('Error: La librería jsPDF no está cargada. Por favor, recarga la página.');
      console.error('jsPDF no está disponible en window.jspdf');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const info = getStatusAndSaldo(loan);
    const fechaActual = new Date();
    const fechaPago = pago.fecha ? new Date(pago.fecha) : fechaActual;
    
    // Calcular cuotas pagadas hasta este pago (incluyendo este pago)
    const pagosHastaEste = (loan.pagos || []).filter(p => {
      const fechaP = p.fecha ? new Date(p.fecha) : new Date();
      return fechaP <= fechaPago;
    });
    const cuotaNumero = pagosHastaEste.length;
    
    // Calcular información del préstamo
    const capital = parseFloat(loan.capital || 0);
    const interesPorcentaje = parseFloat(loan.interes || 0);
    const interesTotal = capital * (interesPorcentaje / 100);
    const deudaTotal = capital + interesTotal;

    // Encabezado
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('RECIBO DE PAGO', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('Sistema de Control de Préstamos', 105, 30, { align: 'center' });

    // Información del recibo
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('INFORMACIÓN DEL CLIENTE', 20, 55);
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    let yPos = 65;
    doc.text(`Nombre: ${loan.nombre}`, 20, yPos);
    yPos += 8;
    doc.text(`Teléfono: ${loan.telefono || 'No registrado'}`, 20, yPos);
    
    yPos += 15;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.text('DETALLES DEL PAGO', 20, yPos);
    
    yPos += 10;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(11);
    doc.text(`Fecha del pago: ${fechaPago.toLocaleDateString('es-PE', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}`, 20, yPos);
    yPos += 8;
    doc.setFont(undefined, 'bold');
    doc.text(`Monto pagado: S/${parseFloat(pago.monto).toFixed(2)}`, 20, yPos);
    
    yPos += 15;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('INFORMACIÓN DEL PRÉSTAMO', 20, yPos);
    
    yPos += 10;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(11);
    doc.text(`Capital original: S/${parseFloat(loan.capital).toFixed(2)}`, 20, yPos);
    yPos += 8;
    doc.text(`Interés por período: ${parseFloat(loan.interes).toFixed(2)}%`, 20, yPos);
    yPos += 8;
    doc.text(`Método de pago: ${loan.metodoPago.charAt(0).toUpperCase() + loan.metodoPago.slice(1)}`, 20, yPos);
    yPos += 8;
    doc.text(`Cuota número: ${cuotaNumero} de ${loan.cantidadPeriodos}`, 20, yPos);
    yPos += 8;
    
    // Calcular saldo después de este pago
    const totalPagadoHastaEste = pagosHastaEste.reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
    const saldoDespues = Math.max(0, deudaTotal - totalPagadoHastaEste);
    
    doc.setFont(undefined, 'bold');
    doc.text(`Saldo pendiente después del pago: S/${saldoDespues.toFixed(2)}`, 20, yPos);
    
    // Línea separadora
    yPos += 15;
    doc.setDrawColor(200, 200, 200);
    doc.line(20, yPos, 190, yPos);
    
    // Pie de página
    yPos += 15;
    doc.setFontSize(9);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(`Recibo generado el ${fechaActual.toLocaleDateString('es-PE')} a las ${fechaActual.toLocaleTimeString('es-PE')}`, 20, yPos);
    yPos += 8;
    doc.text('Este documento es una evidencia del pago realizado.', 20, yPos);
    
    // Guardar PDF
    const nombreArchivo = `recibo_${loan.nombre.replace(/\s+/g, '_')}_${fechaPago.toISOString().slice(0, 10)}.pdf`;
    doc.save(nombreArchivo);
    
  } catch (error) {
    console.error('Error al generar el recibo PDF:', error);
    alert('Error al generar el recibo. Por favor, intente nuevamente.');
  }
}

async function deletePayment(loanId, paymentIndex, movimientoId) {
  if (!confirm('¿Está seguro de eliminar este pago? Esto afectará el contador de cuotas, el resumen financiero y el historial de movimientos.')) return;

  try {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) {
      alert('Error: No se encontró el préstamo.');
      return;
    }

    // Buscar el pago por movimientoId en lugar de usar el índice
    let pagoAEliminar = null;
    if (movimientoId) {
      const index = (loan.pagos || []).findIndex(p => p.movimientoId === movimientoId);
      if (index !== -1) {
        pagoAEliminar = loan.pagos[index];
        loan.pagos.splice(index, 1);
      }
    } else {
      // Si no hay movimientoId, usar el índice como fallback
      if (paymentIndex >= 0 && paymentIndex < (loan.pagos || []).length) {
        pagoAEliminar = loan.pagos[paymentIndex];
        loan.pagos.splice(paymentIndex, 1);
      }
    }

    if (!pagoAEliminar) {
      alert('Error: No se encontró el pago a eliminar.');
      return;
    }

    // Actualizar el préstamo sin el pago eliminado
    await getLoansCollection().doc(loanId).update({ pagos: loan.pagos });

    // Eliminar el movimiento de la colección de movimientos
    if (movimientoId) {
      try {
        await getMovimientosCollection().doc(movimientoId).delete();
      } catch (movError) {
        console.warn('No se pudo eliminar el movimiento, pero el pago fue eliminado del préstamo:', movError);
      }
    }

    // Recargar el modal con los datos actualizados
    openModal(loanId);
    
    // El resumen financiero y el historial se actualizarán automáticamente
    // gracias a los listeners de Firestore (setupRealtimeListeners)
    
  } catch (error) {
    console.error('Error al eliminar el pago:', error);
    alert('Error al eliminar el pago. Por favor, intente nuevamente.');
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';

  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const filtered = movimientos.filter(mov => {
    const movDate = mov.timestamp?.toDate?.() || new Date();
    return !(mov.tipo === 'gasto' && movDate < oneMonthAgo);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<li style="text-align:center;padding:20px;color:#666;">No hay movimientos recientes.</li>';
    return;
  }

  filtered.forEach(mov => {
    const date = mov.timestamp?.toDate?.() || new Date();
    const li = document.createElement('li');
    li.style.cssText = 'background:white;padding:15px;margin:10px 0;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);position:relative;';
    li.innerHTML = `<div style="padding-right:50px;">
      <strong>${formatDateTime(mov.timestamp)}</strong><br>
      ${mov.tipo === 'pago' ? '🟢 Pago' : mov.tipo === 'gasto' ? '🔴 Gasto' : '🔵 Movimiento'} S/${parseFloat(mov.monto).toFixed(2)}<br>
      ${mov.tipo === 'pago' ? `De: ${mov.nombre}` : mov.motivo ? `Motivo: ${mov.motivo}` : ''}
    </div>`;

    const deleteIcon = document.createElement('span');
    deleteIcon.innerHTML = '🗑️';
    deleteIcon.style.cssText = 'position:absolute;top:10px;right:15px;font-size:1.4em;cursor:pointer;';
    deleteIcon.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('¿Eliminar este movimiento? Esto también eliminará el pago del detalle del préstamo si corresponde.')) {
        try {
          if (mov.tipo === 'pago' && mov.loanId) {
            const loanDoc = await getLoansCollection().doc(mov.loanId).get();
            if (loanDoc.exists) {
              let pagos = loanDoc.data().pagos || [];
              const movDate = mov.timestamp?.toDate?.() || new Date();
              const movDateStr = movDate.toISOString().slice(0, 10); // YYYY-MM-DD
              
              // Buscar y eliminar el pago que coincida con el movimientoId O con la fecha y monto
              pagos = pagos.filter(p => {
                // Si tiene movimientoId y coincide, eliminar directamente
                if (p.movimientoId === mov.id) {
                  return false; // Eliminar este pago
                }
                
                // Si no tiene movimientoId o no coincide por ID, comparar por fecha y monto
                const pagoDate = p.fecha ? new Date(p.fecha).toISOString().slice(0, 10) : null;
                const mismoDia = pagoDate === movDateStr;
                const mismoMonto = Math.abs(parseFloat(p.monto || 0) - parseFloat(mov.monto || 0)) < 0.01;
                
                // Si es el mismo día y mismo monto, es el mismo pago
                if (mismoDia && mismoMonto) {
                  return false; // Eliminar este pago
                }
                
                return true; // Mantener este pago
              });
              
              await getLoansCollection().doc(mov.loanId).update({ pagos });
              
              // Si el modal está abierto, recargarlo
              const modal = document.getElementById('modal');
              if (modal && modal.style.display === 'block') {
                openModal(mov.loanId);
              }
            }
          }
          
          // Eliminar el movimiento
          await getMovimientosCollection().doc(mov.id).delete();
        } catch (err) {
          console.error('Error al eliminar el movimiento:', err);
          alert('Error al eliminar el movimiento.');
        }
      }
    };
    li.appendChild(deleteIcon);
    list.appendChild(li);
  });
}

function calcularPlazoDias(metodo, cantidad) {
  if (metodo === 'semanal') return cantidad * 7;
  if (metodo === 'mensual') return cantidad * 30;
  return cantidad;
}

function updateSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let capitalActivo = 0, cobradoHoy = 0, cobroEsperadoHoy = 0, totalPorCobrar = 0, prestamosActivos = 0;

  loans.forEach(loan => {
    const info = getStatusAndSaldo(loan);
    if (!info.prestamoFinalizado) {
      capitalActivo += parseFloat(loan.capital);
      totalPorCobrar += info.saldoPendiente;
      prestamosActivos++;

      const diasTranscurridos = Math.floor((today - new Date(loan.fecha)) / 86400000);
      if (diasTranscurridos >= 0 && diasTranscurridos < loan.plazoDias) {
        cobroEsperadoHoy += info.cuotaPorPeriodo;
      }
    }
  });

  movimientos.forEach(mov => {
    const movDate = mov.timestamp?.toDate?.() || new Date();
    if (movDate.toDateString() === today.toDateString()) {
      if (mov.tipo === 'pago') cobradoHoy += parseFloat(mov.monto);
      if (mov.tipo === 'gasto') cobradoHoy -= parseFloat(mov.monto);
    }
  });

  document.getElementById('capital-activo').textContent = capitalActivo.toFixed(2);
  document.getElementById('cobrado-hoy').textContent = Math.max(0, cobradoHoy).toFixed(2);
  document.getElementById('cobro-esperado-hoy').textContent = cobroEsperadoHoy.toFixed(2);
  document.getElementById('total-por-cobrar').textContent = totalPorCobrar.toFixed(2);
  document.getElementById('prestamos-activos').textContent = prestamosActivos;
}

async function deleteLoan(loanId) {
  if (confirm('¿Desea eliminar este préstamo permanentemente?')) {
    try {
      await getLoansCollection().doc(loanId).delete();
    } catch (error) {
      alert('Error al eliminar el préstamo.');
    }
  }
}

function setupEventListeners() {
  // Nuevo préstamo
  document.getElementById('loan-form').addEventListener('submit', async e => {
    e.preventDefault();
    const metodo = document.getElementById('metodo-pago').value;
    const cantidad = parseInt(document.getElementById('plazo-cantidad').value);
    const plazoDias = calcularPlazoDias(metodo, cantidad);

    const loan = {
      nombre: document.getElementById('nombre').value.trim(),
      telefono: document.getElementById('telefono').value.replace(/\D/g, '').trim() || null,
      capital: parseFloat(document.getElementById('capital').value),
      interes: parseFloat(document.getElementById('interes').value),
      plazoDias,
      metodoPago: metodo,
      cantidadPeriodos: cantidad,
      fecha: document.getElementById('fecha').value || new Date().toISOString().slice(0, 10),
      notas: document.getElementById('notas').value.trim(),
      pagos: [],
      renovado: false
    };

    try {
      await getLoansCollection().add(loan);
      e.target.reset();
    } catch (error) {
      alert('Error al agregar el préstamo.');
    }
  });

  // Edición de préstamo
  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const loanId = document.getElementById('edit-loan-id').value;
    const metodo = document.getElementById('edit-metodo-pago').value;
    const cantidadPeriodos = parseInt(document.getElementById('edit-cantidad-periodos').value);
    const plazoDias = calcularPlazoDias(metodo, cantidadPeriodos);

    const updatedLoan = {
      nombre: document.getElementById('edit-nombre').value.trim(),
      telefono: document.getElementById('edit-telefono').value.replace(/\D/g, '').trim() || null,
      capital: parseFloat(document.getElementById('edit-capital').value),
      interes: parseFloat(document.getElementById('edit-interes').value),
      metodoPago: metodo,
      cantidadPeriodos: cantidadPeriodos,
      plazoDias: plazoDias,
      fecha: document.getElementById('edit-fecha').value,
      notas: document.getElementById('edit-notas').value.trim()
    };

    try {
      await getLoansCollection().doc(loanId).update(updatedLoan);
      document.getElementById('edit-modal').style.display = 'none';
      alert('Préstamo actualizado correctamente.');
    } catch (error) {
      alert('Error al actualizar el préstamo.');
      console.error(error);
    }
  });

  // Cerrar modal de edición
  document.querySelector('.close-edit').onclick = () => {
    document.getElementById('edit-modal').style.display = 'none';
  };

  // Agregar gasto
  document.getElementById('add-expense-btn').onclick = () => {
    document.getElementById('expense-modal').style.display = 'block';
  };

  document.getElementById('save-expense').onclick = async () => {
    const motivo = document.getElementById('expense-motive').value.trim();
    const monto = parseFloat(document.getElementById('expense-amount').value);

    if (!motivo || isNaN(monto) || monto <= 0) {
      alert('Complete correctamente los campos.');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cobradoHoy = 0;
    
    // Calcular el cobrado neto de hoy (pagos - gastos)
    movimientos.forEach(m => {
      const mDate = m.timestamp?.toDate?.() || new Date();
      mDate.setHours(0, 0, 0, 0);
      if (mDate.getTime() === today.getTime()) {
        if (m.tipo === 'pago') cobradoHoy += parseFloat(m.monto || 0);
        if (m.tipo === 'gasto') cobradoHoy -= parseFloat(m.monto || 0);
      }
    });

    // Validar que el gasto no exceda lo cobrado hoy
    if (monto > cobradoHoy) {
      alert(`El gasto no puede exceder el cobrado neto del día (S/${cobradoHoy.toFixed(2)}).`);
      return;
    }

    try {
      await getMovimientosCollection().add({
        tipo: 'gasto',
        monto,
        motivo,
        timestamp: firebase.firestore.Timestamp.now()
      });
      document.getElementById('expense-modal').style.display = 'none';
      document.getElementById('expense-motive').value = '';
      document.getElementById('expense-amount').value = '';
    } catch (error) {
      console.error('Error al guardar el gasto:', error);
      alert('Error al guardar el gasto.');
    }
  };

  // Historial
  document.getElementById('history-btn').onclick = () => {
    renderHistory();
    document.getElementById('history-modal').style.display = 'block';
  };

  // Cerrar modales
  document.querySelectorAll('.close, .close-expense, .close-history').forEach(el => {
    el.onclick = () => el.closest('.modal').style.display = 'none';
  });

  window.onclick = e => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  };

  // Búsqueda
  document.getElementById('search-input').addEventListener('keyup', renderLoans);

  // Cerrar sesión
  document.getElementById('logout-btn').onclick = async () => {
    if (confirm('¿Desea cerrar sesión?')) {
      await auth.signOut();
      window.location.replace('login.html');
    }
  };
}