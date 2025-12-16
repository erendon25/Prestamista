let loans = JSON.parse(localStorage.getItem('loans')) || [];
let currentFilter = 'todos';

function saveLoans() {
    localStorage.setItem('loans', JSON.stringify(loans));
}

function calculateEndDate(fechaPrestamo, plazoDias) {
    if (!fechaPrestamo) return null;
    const date = new Date(fechaPrestamo);
    date.setDate(date.getDate() + plazoDias);
    return date;
}

function getStatusAndMora(loan) {
    if (!loan.fecha) return { status: 'sin-fecha', diasMora: 0, moraAcumulada: 0, totalConMora: 0, endDate: null };

    const endDate = calculateEndDate(loan.fecha, loan.plazoDias);
    if (!endDate) return { status: 'sin-fecha', diasMora: 0, moraAcumulada: 0, totalConMora: 0, endDate: null };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((today - endDate) / (1000 * 60 * 60 * 24)); // Días vencidos

    let status = 'verde';
    if (diffDays >= 1) status = 'rojo';
    else if (diffDays === 0 || (diffDays < 0 && diffDays > -4)) status = 'amarillo';

    const diasMora = Math.max(0, diffDays);

    let moraAcumulada = 0;
    let totalConMora = 0;

    if (diasMora > 0 && loan.mora > 0) {
        const tasaMoraDiaria = loan.mora / 100; // Ahora es porcentaje diario
        moraAcumulada = loan.capital * tasaMoraDiaria * diasMora; // Interés simple diario
    }

    const cuotaDiaria = calculateDailyPayment(loan.capital, loan.interes, loan.plazoDias);
    const totalOriginal = cuotaDiaria * loan.plazoDias;
    totalConMora = totalOriginal + moraAcumulada;

    return { status, diasMora, moraAcumulada, totalConMora, endDate };
}

function calculateDailyPayment(capital, interesAnual, plazoDias) {
    if (plazoDias === 0 || interesAnual === 0) return capital / plazoDias || 0;
    const tasaDiaria = interesAnual / 100 / 365;
    return (capital * tasaDiaria) / (1 - Math.pow(1 + tasaDiaria, -plazoDias));
}

function formatDate(date) {
    if (!date) return 'No registrada';
    return new Date(date).toLocaleDateString('es-PE');
}

function renderLoans(filter = currentFilter) {
    const list = document.getElementById('loans-list');
    list.innerHTML = '';

    let filteredLoans = loans;
    if (filter === 'activos') filteredLoans = loans.filter(l => getStatusAndMora(l).status === 'verde');
    else if (filter === 'por-vencer') filteredLoans = loans.filter(l => getStatusAndMora(l).status === 'amarillo');
    else if (filter === 'vencidos') filteredLoans = loans.filter(l => getStatusAndMora(l).status === 'rojo');

    if (filteredLoans.length === 0) {
        list.innerHTML = '<li style="text-align:center; color:#888;">No hay préstamos en esta categoría.</li>';
        return;
    }

    filteredLoans.forEach((loan, index) => {
        const { status, diasMora, moraAcumulada, totalConMora, endDate } = getStatusAndMora(loan);
        const cuotaDiaria = calculateDailyPayment(loan.capital, loan.interes, loan.plazoDias);

        const li = document.createElement('li');
        li.classList.add('status-' + status);

        let moraInfo = '';
        if (diasMora > 0 && moraAcumulada > 0) {
            moraInfo = `<br><strong style="color:#dc3545;">Mora (${diasMora} días): S/${moraAcumulada.toFixed(2)}</strong> | 
                        Total con mora: S/${totalConMora.toFixed(2)}`;
        }

        li.innerHTML = `
            <span class="loan-info">
                <strong>${loan.nombre}</strong><br>
                Prestado: S/${loan.capital.toFixed(2)} | Interés: ${loan.interes}% anual
                ${loan.mora > 0 ? ` | Mora: ${loan.mora}% diaria` : ''}<br>
                Plazo: ${loan.plazoDias} días | Vence: ${formatDate(endDate)}<br>
                Cuota diaria: S/${cuotaDiaria.toFixed(2)}${moraInfo}
            </span>
            <div class="actions">
                <button class="edit-btn" data-index="${loans.indexOf(loan)}">Editar</button>
                <button class="delete-btn" data-index="${loans.indexOf(loan)}">Eliminar</button>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (!e.target.matches('button')) {
                showDetails(loan, cuotaDiaria, status, diasMora, moraAcumulada, totalConMora, endDate);
            }
        });

        list.appendChild(li);
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(parseInt(btn.getAttribute('data-index')));
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteLoan(parseInt(btn.getAttribute('data-index')));
        });
    });
}

function showDetails(loan, cuotaDiaria, status, diasMora, moraAcumulada, totalConMora, endDate) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');

    let statusText = status === 'verde' ? '<span style="color:#28a745;">Activo</span>' :
                     status === 'amarillo' ? '<span style="color:#ffc107;"><strong>Por vencer</strong></span>' :
                     '<span style="color:#dc3545;"><strong>Vencido</strong></span>';

    let moraDetalle = '';
    if (diasMora > 0 && moraAcumulada > 0) {
        moraDetalle = `
            <p><strong>Días en mora:</strong> ${diasMora}</p>
            <p><strong>Tasa de mora diaria:</strong> ${loan.mora}%</p>
            <p><strong>Monto de mora acumulada:</strong> <strong style="color:#dc3545;">S/${moraAcumulada.toFixed(2)}</strong></p>
            <p><strong>Total a pagar con mora:</strong> <strong style="color:#dc3545;">S/${totalConMora.toFixed(2)}</strong></p>
        `;
    } else if (loan.mora > 0) {
        moraDetalle = `<p><strong>Tasa de mora diaria configurada:</strong> ${loan.mora}% (se aplica al vencimiento)</p>`;
    }

    body.innerHTML = `
        <p><strong>Nombre:</strong> ${loan.nombre}</p>
        <p><strong>Teléfono:</strong> ${loan.telefono || 'No registrado'}</p>
        <p><strong>Dirección:</strong> ${loan.direccion || 'No registrado'}</p>
        <p><strong>Capital prestado:</strong> S/${loan.capital.toFixed(2)}</p>
        <p><strong>Interés anual:</strong> ${loan.interes}%</p>
        ${loan.mora > 0 ? `<p><strong>Mora diaria:</strong> ${loan.mora}%</p>` : ''}
        <p><strong>Plazo:</strong> ${loan.plazoDias} días</p>
        <p><strong>Fecha préstamo:</strong> ${formatDate(loan.fecha)}</p>
        <p><strong>Fecha vencimiento:</strong> ${formatDate(endDate)}</p>
        <p><strong>Estado:</strong> ${statusText}</p>
        <hr>
        <p><strong>Cuota diaria:</strong> <strong style="color:#007bff;">S/${cuotaDiaria.toFixed(2)}</strong></p>
        ${moraDetalle}
        <p><strong>Notas:</strong> ${loan.notas || 'Ninguna'}</p>
    `;
    modal.style.display = 'block';
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

// Agregar nuevo
document.getElementById('loan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const loan = {
        nombre: document.getElementById('nombre').value.trim(),
        telefono: document.getElementById('telefono').value.trim(),
        direccion: document.getElementById('direccion').value.trim(),
        capital: parseFloat(document.getElementById('capital').value),
        interes: parseFloat(document.getElementById('interes').value),
        mora: parseFloat(document.getElementById('mora').value) || 0,  // Ahora es % diario
        plazoDias: parseInt(document.getElementById('plazo-dias').value),
        fecha: document.getElementById('fecha').value,
        notas: document.getElementById('notas').value.trim()
    };
    loans.push(loan);
    saveLoans();
    renderLoans();
    e.target.reset();
});

// Editar
document.getElementById('edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const index = parseInt(document.getElementById('edit-index').value);
    loans[index] = {
        nombre: document.getElementById('edit-nombre').value.trim(),
        telefono: document.getElementById('edit-telefono').value.trim(),
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

function deleteLoan(index) {
    if (confirm('¿Seguro que quieres eliminar este préstamo?')) {
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

// Cerrar modales
document.querySelector('.close').addEventListener('click', () => document.getElementById('modal').style.display = 'none');
document.querySelector('.close-edit').addEventListener('click', () => document.getElementById('edit-modal').style.display = 'none');
window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) document.getElementById('modal').style.display = 'none';
    if (e.target === document.getElementById('edit-modal')) document.getElementById('edit-modal').style.display = 'none';
});

renderLoans();