import { describe, expect, test } from 'bun:test';
import { waitlistLabel, waitlistState } from '../../src/waitlist';

const ticket = (o: Record<string, unknown>) => ({ product_type: 'TICKET', is_sold_out: false, is_available: true, waitlist_enabled: false, ...o });

describe('waitlist state, from Hi.Events’ public event', () => {
  test('sold out with the waitlist on: the waitlist is the only way in', () => {
    const w = waitlistState([ticket({ is_sold_out: true, is_available: false, waitlist_enabled: true })]);
    expect(w).toEqual({ open: true, soldOut: true, waitlistOnly: true, beforeSale: false });
    expect(waitlistLabel(w)).toBe('Sold out · waitlist open');
  });

  test('one ticket sold out while another is on sale: open on some tickets', () => {
    const w = waitlistState([ticket({ is_sold_out: true, is_available: false, waitlist_enabled: true }), ticket({})]);
    expect(w).toMatchObject({ open: true, soldOut: false, waitlistOnly: false });
    expect(waitlistLabel(w)).toBe('Waitlist open on some tickets');
  });

  test('before the sale opens', () => {
    const w = waitlistState([ticket({ is_before_sale_start_date: true, is_available: false, waitlist_enabled: true })]);
    expect(w).toMatchObject({ open: true, beforeSale: true, waitlistOnly: true });
    expect(waitlistLabel(w)).toBe('Waitlist open before sales');
  });

  test('sold out without a waitlist; ended tickets and add-ons do not count', () => {
    const w = waitlistState([
      ticket({ is_sold_out: true, is_available: false }),
      ticket({ is_after_sale_end_date: true, is_available: false, waitlist_enabled: true }),
      { product_type: 'GENERAL', is_sold_out: false, is_available: true },
    ]);
    expect(w).toEqual({ open: false, soldOut: true, waitlistOnly: false, beforeSale: false });
    expect(waitlistLabel(w)).toBe('Sold out');
    expect(waitlistLabel(waitlistState([ticket({})]))).toBe('');
    expect(waitlistState([]).soldOut).toBe(false);
  });
});
