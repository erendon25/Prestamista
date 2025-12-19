// Inicialización de variables globales: carga los préstamos desde localStorage o inicia un array vacío.
// currentFilter almacena el filtro actual de la lista, currentLoanIndex el índice del préstamo en el modal.
let loans = JSON.parse(localStorage.getItem('loans')) || [];
let currentFilter = 'todos';
let currentLoanIndex = null;

// Función para guardar los préstamos en localStorage y actualizar el resumen financiero.
function saveLoans() {
    localStorage.setItem('loans', JSON.stringify(loans));
    updateSummary();
}

// Calcula la fecha de vencimiento sumando los días de plazo a la fecha inicial.
function calculateEndDate(fecha, plazoDias) {
    if (!fecha) return null;
    const date = new Date(fecha);
    date.setDate(date.getDate() + plazoDias);
    return date;
}

// Obtiene el estado del préstamo, días en mora, mora acumulada, total con mora, saldo pendiente, etc.
// Calcula el estado basado en días restantes o pasados, y ajusta el saldo considerando pagos y mora.
function getStatusAndMora(loan) {
    if (!loan.fecha) return { status: 'sin-fecha', diasMora: 0, moraAcumulada: 0, totalConMora: 0, endDate: null, saldoPendiente: 0, totalPagado: 0, cuotaDiaria: 0 };

    const endDate = calculateEndDate(loan.fecha, loan.plazoDias);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));

    let status = 'verde';
    if (diffDays >= 1) status = 'rojo';
    else if (diffDays === 0 || (diffDays < 0 && diffDays > -4)) status = 'amarillo';

    const diasMora = Math.max(0, diffDays);

    const pagos = loan.pagos || [];
    const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);

    const cuotaDiaria = calculateDailyPayment(loan.capital, loan.interes, loan.plazoDias);
    const totalOriginal = cuotaDiaria * loan.plazoDias;

    let moraAcumulada = 0;
    if (diasMora > 0 && loan.mora > 0) {
        moraAcumulada = loan.capital * (loan.mora / 100) * diasMora;
    }

    const totalConMora = totalOriginal + moraAcumulada;
    const saldoPendiente = Math.max(0, totalConMora - totalPagado);

    return { status, diasMora, moraAcumulada, totalConMora, endDate, saldoPendiente, totalPagado, cuotaDiaria };
}

// Calcula la cuota diaria basada en capital, interés total fijo y plazo en días.
function calculateDailyPayment(capital, interesPorcentaje, plazoDias) {
    if (!interesPorcentaje || interesPorcentaje <= 0 || !plazoDias) {
        return capital / plazoDias || 0;
    }
    const interesTotal = capital * (interesPorcentaje / 100);
    const montoTotal = capital + interesTotal;
    return montoTotal / plazoDias;
}

// Formatea una fecha a formato local (es-PE) o 'No registrada' si no hay fecha.
function formatDate(date) {
    if (!date) return 'No registrada';
    return new Date(date).toLocaleDateString('es-PE');
}

// Formatea un timestamp o fecha ISO a fecha y hora local (es-PE). Compatible con datos antiguos que usan 'fecha'.
function formatDateTime(pago) {
    let ts = pago.timestamp || pago.fecha;
    if (!ts) return 'No registrada';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return 'Fecha inválida';
    return date.toLocaleDateString('es-PE') + (pago.timestamp ? ' ' + date.toLocaleTimeString('es-PE') : '');
}

// Actualiza el resumen financiero: capital activo, cobrado hoy, mora total, total por cobrar y préstamos activos.
// Itera sobre los préstamos para calcular estos valores, excluyendo renovados o pagados.
// Compatible con pagos antiguos que usan 'fecha'.
function updateSummary() {
    const todayStr = new Date().toISOString().slice(0, 10);
    let capitalActivo = 0, cobradoHoy = 0, moraTotal = 0, totalPorCobrar = 0, activos = 0;

    loans.forEach(loan => {
        const info = getStatusAndMora(loan);
        if (!loan.renovado && info.saldoPendiente > 0) {
            capitalActivo += loan.capital;
            totalPorCobrar += info.saldoPendiente;
            activos++;
        }
        moraTotal += info.moraAcumulada;

        (loan.pagos || []).forEach(p => {
            let payDate = p.timestamp ? p.timestamp.slice(0, 10) : p.fecha;
            if (payDate === todayStr) cobradoHoy += p.monto;
        });
    });

    document.getElementById('capital-activo').textContent = capitalActivo.toFixed(2);
    document.getElementById('cobrado-hoy').textContent = cobradoHoy.toFixed(2);
    document.getElementById('mora-total').textContent = moraTotal.toFixed(2);
    document.getElementById('total-por-cobrar').textContent = totalPorCobrar.toFixed(2);
    document.getElementById('prestamos-activos').textContent = activos;
}

// Busca préstamos por término en nombre o teléfono y renderiza la lista filtrada.
function searchLoans() {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderLoans(currentFilter, term);
}

// Renderiza la lista de préstamos según filtro y término de búsqueda.
// Calcula cuotas pagadas basado en total pagado dividido por cuota diaria (floor y min al plazo).
// Genera HTML para cada préstamo, incluyendo estado, info y botones de acciones.
function renderLoans(filter = 'todos', searchTerm = '') {
    const list = document.getElementById('loans-list');
    list.innerHTML = '';

    let filtered = loans.filter(loan => {
        if (filter === 'activos') return getStatusAndMora(loan).status === 'verde';
        if (filter === 'por-vencer') return getStatusAndMora(loan).status === 'amarillo';
        if (filter === 'vencidos') return getStatusAndMora(loan).status === 'rojo';
        return true;
    });

    if (searchTerm) {
        filtered = filtered.filter(loan =>
            loan.nombre.toLowerCase().includes(searchTerm) ||
            (loan.telefono || '').toString().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        list.innerHTML = '<li style="text-align:center; color:#888;">No hay préstamos que coincidan.</li>';
        return;
    }

    filtered.forEach((loan, originalIndex) => {
        const info = getStatusAndMora(loan);

        // Calcula cuotas pagadas basado en monto total pagado / cuota diaria, no en días únicos.
        // Esto permite que múltiples pagos (incluso en el mismo día) sumen cuotas si cubren múltiplos de la cuota.
        const cuotasPagadas = info.cuotaDiaria > 0 ? Math.min(Math.floor(info.totalPagado / info.cuotaDiaria), loan.plazoDias) : 0;
        const totalCuotas = loan.plazoDias;

        const li = document.createElement('li');
        li.classList.add('status-' + info.status);

        const iconoRenovacion = loan.esRenovacion ? ' <span style="font-size:1.3em;">↻</span>' : '';
        const renovadoTexto = loan.renovado ? ' <em style="color:#6c757d;">(Renovado)</em>' : '';

        let moraInfo = info.diasMora > 0 && info.moraAcumulada > 0
            ? `<br><strong style="color:#dc3545;">Mora: S/${info.moraAcumulada.toFixed(2)}</strong>`
            : '';

        const estiloCompletado = loan.renovado ? 'opacity: 0.7; text-decoration: line-through;' : '';

        li.innerHTML = `
            <span class="loan-info" style="${estiloCompletado}">
                <strong>${loan.nombre}${iconoRenovacion}${renovadoTexto}</strong> - Tel: ${loan.telefono || 'N/A'}<br>
                Prestado: S/${loan.capital.toFixed(2)} | Cuota diaria: S/${info.cuotaDiaria.toFixed(2)}<br>
                <strong>Cuotas pagadas: ${cuotasPagadas} de ${totalCuotas}</strong><br>
                Vence: ${formatDate(info.endDate)} | Saldo pendiente: <strong>S/${info.saldoPendiente.toFixed(2)}</strong>${moraInfo}
            </span>
            <div class="actions">
                <button class="edit-btn" data-index="${originalIndex}">Editar</button>
                <button class="delete-btn" data-index="${originalIndex}">Eliminar</button>
            </div>
        `;

        li.onclick = (e) => {
            if (!e.target.matches('button')) {
                currentLoanIndex = originalIndex;
                showDetails(loan, info, cuotasPagadas, totalCuotas);
            }
        };

        list.appendChild(li);
    });

    document.querySelectorAll('.edit-btn, .delete-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.index);
            btn.classList.contains('edit-btn') ? openEditModal(i) : deleteLoan(i);
        };
    });
}

// Muestra los detalles del préstamo en un modal, incluyendo botones para pago y renovación si aplica.
// Calcula cuotas pagadas de la misma forma corregida.
function showDetails(loan, info, cuotasPagadas, totalCuotas) {
    currentLoanIndex = loans.indexOf(loan);

    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;  // Seguridad adicional

    // Recalcula cuotas pagadas basado en monto total para consistencia.
    cuotasPagadas = info.cuotaDiaria > 0 ? Math.min(Math.floor(info.totalPagado / info.cuotaDiaria), loan.plazoDias) : 0;

    let statusText = info.status === 'verde' ? '<span style="color:#28a745;">Activo</span>' :
                     info.status === 'amarillo' ? '<span style="color:#ffc107;"><strong>Por vencer</strong></span>' :
                     '<span style="color:#dc3545;"><strong>Vencido</strong></span>';

    let renovadoNota = loan.renovado ? '<p style="color:#6c757d;"><em>Este préstamo fue renovado y cerrado.</em></p>' : '';

    // Solo muestra botón de pago si saldo pendiente > 0 y no renovado.
    let botonPago = !loan.renovado && info.saldoPendiente > 0 ? 
        `<button onclick="addPayment(${currentLoanIndex})" style="background:#28a745; color:white; padding:12px; border:none; border-radius:5px; width:100%; margin-top:10px; font-size:1.1em;">+ Registrar Pago Hoy</button>` : '';

    let botonRenovar = !loan.renovado && info.saldoPendiente > 0 ? 
        `<button onclick="renewLoan(${currentLoanIndex})" style="background:#007bff; color:white; padding:12px; border:none; border-radius:5px; width:100%; margin-top:10px; font-size:1.1em;">Renovar con Saldo Pendiente</button>` : '';

    modalBody.innerHTML = `
        ${renovadoNota}
        <p><strong>Nombre:</strong> ${loan.nombre}</p>
        <p><strong>Teléfono:</strong> ${loan.telefono || 'No registrado'}</p>
        <p><strong>Capital prestado:</strong> S/${loan.capital.toFixed(2)}</p>
        <p><strong>Interés diario:</strong> ${loan.interes}%</p>
        ${loan.mora > 0 ? `<p><strong>Mora diaria:</strong> ${loan.mora}%</p>` : ''}
        <p><strong>Plazo:</strong> ${loan.plazoDias} días</p>
        <p><strong>Fecha préstamo:</strong> ${formatDate(loan.fecha)}</p>
        <p><strong>Fecha vencimiento:</strong> ${formatDate(info.endDate)}</p>
        <p><strong>Estado:</strong> ${statusText}</p>
        <p><strong>Cuotas pagadas:</strong> ${cuotasPagadas} de ${totalCuotas}</p>
        <hr>
        <p><strong>Cuota diaria:</strong> <strong style="color:#007bff;">S/${info.cuotaDiaria.toFixed(2)}</strong></p>
        <p><strong>Saldo pendiente actual:</strong> <strong style="font-size:1.4em; color:#dc3545;">S/${info.saldoPendiente.toFixed(2)}</strong></p>
        ${info.moraAcumulada > 0 ? `<p><strong>Mora acumulada:</strong> S/${info.moraAcumulada.toFixed(2)}</p>` : ''}
        <hr>
        <h3>Historial de Pagos</h3>
        <ul id="payment-history"></ul>
        ${botonPago}
        ${botonRenovar}
        <p><strong>Notas:</strong> ${loan.notas || 'Ninguna'}</p>
    `;

    // Poblar el historial de pagos con fecha, hora y monto, haciendo cada item clickeable para generar recibo PDF.
    const historyList = document.getElementById('payment-history');
    if (historyList) {
        historyList.innerHTML = '';
        (loan.pagos || []).forEach((p, pagoIndex) => {
            const li = document.createElement('li');
            li.textContent = `${formatDateTime(p)} - Pagó S/${p.monto.toFixed(2)}`;
            li.onclick = () => generateReceiptPDF(loan, p, pagoIndex);
            historyList.appendChild(li);
        });
    }

    document.getElementById('modal').style.display = 'block';
}

// Genera un recibo de pago en PDF usando jsPDF, con un formato más profesional y compatible con datos antiguos.
function generateReceiptPDF(loan, pago, pagoIndex) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let timestamp = pago.timestamp || pago.fecha;
    const dateObj = new Date(timestamp);
    const fecha = dateObj.toLocaleDateString('es-PE');
    const hora = pago.timestamp ? dateObj.toLocaleTimeString('es-PE') : 'No disponible';
    const fileName = `Recibo_Pago_${fecha.replace(/\//g, '-')}.pdf`;

    // Formato profesional de recibo
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text('RECIBO DE PAGO', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Número de Recibo: ${pagoIndex + 1}`, 20, 40);
    doc.text(`Fecha: ${fecha}`, 20, 50);
    doc.text(`Hora: ${hora}`, 20, 60);

    // Línea separadora
    doc.setLineWidth(0.5);
    doc.line(20, 65, 190, 65);

    doc.text(`Deudor: ${loan.nombre}`, 20, 75);
    doc.text(`Teléfono: ${loan.telefono || 'N/A'}`, 20, 85);
    doc.text(`Capital Prestado: S/${loan.capital.toFixed(2)}`, 20, 95);
    doc.text(`Monto Pagado: S/${pago.monto.toFixed(2)}`, 20, 105);
    doc.text(`Notas del Préstamo: ${loan.notas || 'Ninguna'}`, 20, 115);

    // Línea separadora inferior
    doc.line(20, 120, 190, 120);

    doc.setFontSize(10);
    doc.text('Gracias por su pago. Este recibo confirma la recepción del monto indicado.', 105, 135, { align: 'center' });

    doc.save(fileName);
}

// Agrega un pago al préstamo: solicita monto, verifica si es válido y actualiza.
// Verifica si saldo pendiente > 0 antes de permitir el pago.
// Registra timestamp completo para nuevos pagos.
function addPayment(index) {
    const loan = loans[index];
    const info = getStatusAndMora(loan);

    // Impide registrar pagos si el saldo pendiente ya es cero o negativo.
    if (info.saldoPendiente <= 0) {
        alert("La deuda ya está cancelada. No se pueden registrar más pagos.");
        return;
    }

    const montoStr = prompt(`¿Cuánto pagó hoy?\n(Cuota sugerida: S/${info.cuotaDiaria.toFixed(2)})`, info.cuotaDiaria.toFixed(2));
    if (montoStr && !isNaN(montoStr) && parseFloat(montoStr) > 0) {
        const monto = parseFloat(montoStr);
        if (!loan.pagos) loan.pagos = [];
        loan.pagos.push({
            timestamp: new Date().toISOString(),
            monto: monto
        });
        saveLoans();
        renderLoans();
        alert(`Pago de S/${monto.toFixed(2)} registrado correctamente.`);
        document.getElementById('modal').style.display = 'none';
    }
}

// Renueva un préstamo con el saldo pendiente como nuevo capital, crea un nuevo préstamo y marca el viejo como renovado.
function renewLoan(index) {
    const loan = loans[index];
    const info = getStatusAndMora(loan);

    if (loan.renovado) {
        alert("Este préstamo ya fue renovado.");
        return;
    }

    if (info.saldoPendiente <= 0) {
        alert("No hay saldo pendiente para renovar.");
        return;
    }

    const nuevoPlazoStr = prompt("Nuevo plazo en días para la renovación:", loan.plazoDias);
    if (!nuevoPlazoStr || isNaN(nuevoPlazoStr) || parseInt(nuevoPlazoStr) < 1) {
        alert("Plazo inválido.");
        return;
    }

    if (confirm(`Renovar préstamo:\nNuevo capital: S/${info.saldoPendiente.toFixed(2)}\nPlazo: ${nuevoPlazoStr} días`)) {
        loan.renovado = true;
        loan.notas = `[RENOVADO ${new Date().toLocaleDateString('es-PE')}] ` + (loan.notas || "");

        const nuevoLoan = {
            nombre: loan.nombre,
            telefono: loan.telefono,
            capital: info.saldoPendiente,
            interes: loan.interes,
            mora: loan.mora,
            plazoDias: parseInt(nuevoPlazoStr),
            fecha: new Date().toISOString().slice(0, 10),
            notas: `Renovación automática del préstamo anterior (capital original: S/${loan.capital.toFixed(2)})`,
            pagos: [],
            renovado: false,
            esRenovacion: true
        };

        loans.push(nuevoLoan);
        saveLoans();
        renderLoans();
        alert("¡Préstamo renovado con éxito!\nEl antiguo queda en historial como referencia.");
        document.getElementById('modal').style.display = 'none';
    }
}

// Abre el modal de edición con los datos del préstamo cargados.
function openEditModal(index) {
    const loan = loans[index];
    document.getElementById('edit-index').value = index;
    document.getElementById('edit-nombre').value = loan.nombre;
    document.getElementById('edit-telefono').value = loan.telefono || '';
    document.getElementById('edit-capital').value = loan.capital;
    document.getElementById('edit-interes').value = loan.interes;
    document.getElementById('edit-mora').value = loan.mora || '';
    document.getElementById('edit-plazo').value = loan.plazoDias;
    document.getElementById('edit-fecha').value = loan.fecha || '';
    document.getElementById('edit-notas').value = loan.notas || '';
    document.getElementById('edit-modal').style.display = 'block';
}

// Elimina un préstamo tras confirmación.
function deleteLoan(index) {
    if (confirm('¿Seguro que quieres eliminar este préstamo permanentemente?')) {
        loans.splice(index, 1);
        saveLoans();
        renderLoans();
    }
}

// Cambia el filtro actual y renderiza la lista.
function filterLoans(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.filter-btn[onclick="filterLoans('${type}')"]`).classList.add('active');
    renderLoans(type);
}

// Evento para agregar nuevo préstamo desde el formulario.
document.getElementById('loan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const telInput = document.getElementById('telefono').value.replace(/\D/g, '').trim();
    const loan = {
        nombre: document.getElementById('nombre').value.trim(),
        telefono: telInput || null,
        capital: parseFloat(document.getElementById('capital').value),
        interes: parseFloat(document.getElementById('interes').value),
        mora: parseFloat(document.getElementById('mora').value) || 0,
        plazoDias: parseInt(document.getElementById('plazo-dias').value),
        fecha: document.getElementById('fecha').value || new Date().toISOString().slice(0, 10),
        notas: document.getElementById('notas').value.trim(),
        pagos: [],
        renovado: false,
        esRenovacion: false
    };
    loans.push(loan);
    saveLoans();
    renderLoans();
    e.target.reset();
});

// Evento para editar préstamo desde el modal.
document.getElementById('edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const index = parseInt(document.getElementById('edit-index').value);
    const telInput = document.getElementById('edit-telefono').value.replace(/\D/g, '').trim();
    loans[index] = {
        ...loans[index],
        nombre: document.getElementById('edit-nombre').value.trim(),
        telefono: telInput || null,
        capital: parseFloat(document.getElementById('edit-capital').value),
        interes: parseFloat(document.getElementById('edit-interes').value),
        mora: parseFloat(document.getElementById('edit-mora').value) || 0,
        plazoDias: parseInt(document.getElementById('edit-plazo').value),
        fecha: document.getElementById('edit-fecha').value,
        notas: document.getElementById('edit-notas').value.trim()
    };
    saveLoans();
    renderLoans();
    document.getElementById('edit-modal').style.display = 'none';
});

// Cerrar modales al hacer clic en la X.
document.querySelector('.close').addEventListener('click', () => document.getElementById('modal').style.display = 'none');
document.querySelector('.close-edit').addEventListener('click', () => document.getElementById('edit-modal').style.display = 'none');

// Cerrar modales al hacer clic fuera del contenido.
window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) document.getElementById('modal').style.display = 'none';
    if (e.target === document.getElementById('edit-modal')) document.getElementById('edit-modal').style.display = 'none';
});

// Inicializa la aplicación renderizando la lista y actualizando el resumen.
renderLoans();
updateSummary();