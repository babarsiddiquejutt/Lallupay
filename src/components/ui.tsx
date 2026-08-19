import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export function Button({ children, className = '', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

export function Card({ children }: PropsWithChildren) { return <section className="card">{children}</section>; }
export function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty"><strong>{title}</strong><span>{body}</span></div>; }
