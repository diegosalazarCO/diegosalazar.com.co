export const CONTACT_EMAIL = 'hola@diegosalazar.com.co';
export const DEFAULT_CONTACT_SUBJECT = 'Hi! This is a contact from your website';

export function mailto(subject: string = DEFAULT_CONTACT_SUBJECT): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
