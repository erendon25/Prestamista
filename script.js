let loans = JSON.parse(localStorage.getItem('loans')) || [];
let currentFilter = 'todos';
let currentLoanIndex = null;

function saveLoans() {
    localStorage.setItem('loans', JSON.stringify(loans));
    updateSummary();
}

function calculateEndDate(fecha, plazoDias) {
    if (!fecha) return null;
    const date = new Date(fecha);
    date.setDate(date.getDate() + plazoDias);
    return date;
}

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

function calculateDailyPayment(capital, interesDiarioPorcentaje, plazoDias) {
    if (!interesDiarioPorcentaje || interesDiarioPorcentaje <= 0) {
        return capital / plazoDias || 0;
    }
    const tasaDiaria = interesDiarioPorcentaje / 100;
    return capital * tasaDiaria;
}

function formatDate(date) {
    if (!date) return 'No registrada';
    return new Date(date).toLocaleDateString('es-PE');
}

function updateSummary() {
    const todayStr = new Date().toISOString().slice(0, 10);
    let capitalActivo = 0, cobradoHoy = 0, moraTotal = 0, activos = 0;

    loans.forEach(loan => {
        const info = getStatusAndMora(loan);
        if (!loan.renovado && info.saldoPendiente > 0) {
            capitalActivo += loan.capital;
            activos++;
        }
        moraTotal += info.moraAcumulada;

        (loan.pagos || []).forEach(p => {
            if (p.fecha === todayStr) cobradoHoy += p.monto;
        });
    });

    document.getElementById('capital-activo').textContent = capitalActivo.toFixed(2);
    document.getElementById('cobrado-hoy').textContent = cobradoHoy.toFixed(2);
    document.getElementById('mora-total').textContent = moraTotal.toFixed(2);
    document.getElementById('prestamos-activos').textContent = activos;
}

function searchLoans() {
    const term = document.getElementById('search-input').value.toLowerCase();
    renderLoans(currentFilter, term);
}

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
            (loan.telefono || '').toString().includes(searchTerm) ||
            (loan.direccion || '').toLowerCase().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        list.innerHTML = '<li style="text-align:center; color:#888;">No hay préstamos que coincidan.</li>';
        return;
    }

    filtered.forEach((loan, originalIndex) => {
        const info = getStatusAndMora(loan);

        // Cálculo del contador de cuotas pagadas
        const diasConPago = new Set((loan.pagos || []).map(p => p.fecha)).size;
        const cuotasPagadas = diasConPago;
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

function showDetails(loan, info, cuotasPagadas, totalCuotas) {
    currentLoanIndex = loans.indexOf(loan);
    const body = document.getElementById('modal-body');
    const historyList = document.getElementById('payment-history');
    historyList.innerHTML = '';

    (loan.pagos || []).forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.fecha} - Pagó S/${p.monto.toFixed(2)}`;
        historyList.appendChild(li);
    });

    let statusText = info.status === 'verde' ? '<span style="color:#28a745;">Activo</span>' :
                     info.status === 'amarillo' ? '<span style="color:#ffc107;"><strong>Por vencer</strong></span>' :
                     '<span style="color:#dc3545;"><strong>Vencido</strong></span>';

    let renovadoNota = loan.renovado ? '<p style="color:#6c757d;"><em>Este préstamo fue renovado y cerrado.</em></p>' : '';
    let botonRenovar = !loan.renovado && info.saldoPendiente > 0
        ? `<button onclick="renewLoan(${currentLoanIndex})" style="background:#007bff; color:white; padding:12px; border:none; border-radius:5px; width:100%; margin-top:10px; font-size:1.1em;">Renovar con Saldo Pendiente</button>`
        : '';

    body.innerHTML = `
        ${renovadoNota}
        <p><strong>Nombre:</strong> ${loan.nombre}</p>
        <p><strong>Teléfono:</strong> ${loan.telefono || 'No registrado'}</p>
        <p><strong>Dirección:</strong> ${loan.direccion || 'No registrado'}</p>
        <p><strong>Capital prestado:</strong> S/${loan.capital.toFixed(2)}</p>
        <p><strong>Interés diario:</strong> ${loan.interes}%</p>
        ${loan.mora > 0 ? `<p><strong>Mora diaria:</strong> ${loan.mora}%</p>` : ''}
        <p><strong>Plazo:</strong> ${loan.plazoDias} días</p>
        <p><strong>Fecha préstamo:</strong> ${formatDate(loan.fecha)}</p>
        <p><strong>Fecha vencimiento:</strong> ${formatDate(info.endDate)}</p>
        <p><strong>Estado:</strong> ${statusText}</p>
        <hr>
        <p><strong>Cuotas pagadas:</strong> ${cuotasPagadas} de ${totalCuotas}</p>
        <p><strong>Cuota diaria:</strong> <strong style="color:#007bff;">S/${info.cuotaDiaria.toFixed(2)}</strong></p>
        <p><strong>Saldo pendiente actual:</strong> <strong style="font-size:1.4em; color:#dc3545;">S/${info.saldoPendiente.toFixed(2)}</strong></p>
        ${info.moraAcumulada > 0 ? `<p><strong>Mora acumulada:</strong> S/${info.moraAcumulada.toFixed(2)}</p>` : ''}
        <hr>
        <h3>Historial de Pagos</h3>
        <ul id="payment-history"></ul>
        ${!loan.renovado ? `<button onclick="addPayment(${currentLoanIndex})" style="background:#28a745; color:white; padding:12px; border:none; border-radius:5px; width:100%; margin-top:10px; font-size:1.1em;">+ Registrar Pago Hoy</button>` : ''}
        ${botonRenovar}
        <p><strong>Notas:</strong> ${loan.notas || 'Ninguna'}</p>
    `;

    // Recargar historial (por seguridad)
    (loan.pagos || []).forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.fecha} - Pagó S/${p.monto.toFixed(2)}`;
        document.getElementById('payment-history').appendChild(li);
    });

    document.getElementById('modal').style.display = 'block';
}

function addPayment(index) {
    const loan = loans[index];
    const info = getStatusAndMora(loan);
    const montoStr = prompt(`¿Cuánto pagó hoy?\n(Cuota sugerida: S/${info.cuotaDiaria.toFixed(2)})`, info.cuotaDiaria.toFixed(2));
    if (montoStr && !isNaN(montoStr) && parseFloat(montoStr) > 0) {
        const monto = parseFloat(montoStr);
        if (!loan.pagos) loan.pagos = [];
        loan.pagos.push({
            fecha: new Date().toISOString().slice(0, 10),
            monto: monto
        });
        saveLoans();
        renderLoans();
        alert(`Pago de S/${monto.toFixed(2)} registrado correctamente.`);
        document.getElementById('modal').style.display = 'none';
    }
}

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
            direccion: loan.direccion,
            capital: info.saldoPendiente,
            interes: loan.interes,
            mora: loan.mora,
            plazoDias: parseInt(nuevoPlazoStr),
            fecha: new Date().toISOString().slice(0, 10),
            notas: `Renovación automática del préstamo anterior (capital original: S/${loan.capital.toFixed(2)})`,
            pagos: [],
            esRenovacion: true
        };

        loans.push(nuevoLoan);
        saveLoans();
        renderLoans();
        alert("¡Préstamo renovado con éxito!\nEl antiguo queda en historial como referencia.");
        document.getElementById('modal').style.display = 'none';
    }
}

function openEditModal(index) {
    const loan = loans[index];
    document.getElementById('edit-index').value = index;
    document.getElementById('edit-nombre').value = loan.nombre;
    document.getElementById('edit-telefono').value = loan.telefono || '';
    document.getElementById('edit-direccion').value = loan.direccion || '';
    document.getElementById('edit-capital').value = loan.capital;
    document.getElementById('edit-interes').value = loan.interes;
    document.getElementById('edit-mora').value = loan.mora || '';
    document.getElementById('edit-plazo').value = loan.plazoDias;
    document.getElementById('edit-fecha').value = loan.fecha || '';
    document.getElementById('edit-notas').value = loan.notas || '';
    document.getElementById('edit-modal').style.display = 'block';
}

function deleteLoan(index) {
    if (confirm('¿Seguro que quieres eliminar este préstamo permanentemente?')) {
        loans.splice(index, 1);
        saveLoans();
        renderLoans();
    }
}

function filterLoans(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.filter-btn[onclick="filterLoans('${type}')"]`).classList.add('active');
    renderLoans(type);
}

// Agregar nuevo préstamo
document.getElementById('loan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const telInput = document.getElementById('telefono').value.replace(/\D/g, '').trim();
    const loan = {
        nombre: document.getElementById('nombre').value.trim(),
        telefono: telInput || null,
        direccion: document.getElementById('direccion').value.trim(),
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

// Editar préstamo
document.getElementById('edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const index = parseInt(document.getElementById('edit-index').value);
    const telInput = document.getElementById('edit-telefono').value.replace(/\D/g, '').trim();
    loans[index] = {
        ...loans[index],
        nombre: document.getElementById('edit-nombre').value.trim(),
        telefono: telInput || null,
        direccion: document.getElementById('edit-direccion').value.trim(),
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
function updateSummary() {
    const todayStr = new Date().toISOString().slice(0, 10);
    let capitalActivo = 0, cobradoHoy = 0, moraTotal = 0, totalPorCobrar = 0, activos = 0;

    loans.forEach(loan => {
        const info = getStatusAndMora(loan);
        if (!loan.renovado && info.saldoPendiente > 0) {
            capitalActivo += loan.capital;
            totalPorCobrar += info.saldoPendiente;  // Suma del saldo pendiente (interés + mora - pagos)
            activos++;
        }
        moraTotal += info.moraAcumulada;

        (loan.pagos || []).forEach(p => {
            if (p.fecha === todayStr) cobradoHoy += p.monto;
        });
    });

    document.getElementById('capital-activo').textContent = capitalActivo.toFixed(2);
    document.getElementById('cobrado-hoy').textContent = cobradoHoy.toFixed(2);
    document.getElementById('mora-total').textContent = moraTotal.toFixed(2);
    document.getElementById('total-por-cobrar').textContent = totalPorCobrar.toFixed(2);  // Nueva línea
    document.getElementById('prestamos-activos').textContent = activos;
}

// Cerrar modales
document.querySelector('.close').addEventListener('click', () => document.getElementById('modal').style.display = 'none');
document.querySelector('.close-edit').addEventListener('click', () => document.getElementById('edit-modal').style.display = 'none');

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) document.getElementById('modal').style.display = 'none';
    if (e.target === document.getElementById('edit-modal')) document.getElementById('edit-modal').style.display = 'none';
});

// Inicializar
renderLoans();
updateSummary();