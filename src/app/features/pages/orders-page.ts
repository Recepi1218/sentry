import { Component } from '@angular/core';
import { OrdersTable } from '../finance/orders-table';

/** All of the week's orders, with every cost line and the margin per order. */
@Component({
  selector: 'app-orders-page',
  imports: [OrdersTable],
  template: `
    <div class="page">
      <h2 class="page-title">Ordrar</h2>
      <app-orders-table [limit]="25" [detailed]="true" />
    </div>
  `,
})
export class OrdersPage {}
