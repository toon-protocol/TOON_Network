# Any image may run; capabilities come from listings, not templates

A tenant may spawn any image, named by content address. Templates are a convenience for tenants and give a workload no more privilege than a plain spawn. Anything beyond an ordinary workload, such as Docker inside the workload or nesting, is a capability that a listing grants. Neither a spawn nor a template may carry runtime flags, host mounts or other privileges.

This deliberately departs from Paygress, where providers ran only a vetted template list so no tenant could slip an arbitrary image past them. We chose an open marketplace over that safety property, and moved the privilege decision to the one party who carries the risk: the provider, per listing.

A spawn may set only: the image (by content address, never a mutable tag), environment variables, the ports to expose, a persistent volume up to the listing's storage, SSH access, and the image's entrypoint and arguments.

## Considered Options

- **Vetted templates only (Paygress).** Rejected: it makes the template list the marketplace's gatekeeper.
- **Templates that request privileges, pinned by providers.** Rejected: a provider would be trusting a template author's privilege request rather than deciding per listing itself.
