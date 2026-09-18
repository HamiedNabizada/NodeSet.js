# UaModeler.js (working name)

A graphical modeler for OPC UA information models. Types and instances are
drawn in the notation of OPC 10000-3 Annex C and stored as NodeSet2 files,
with nothing in between. It runs in the browser and is embedded in the
AutomationML Editor plugin [AMLOpcUa](../AMLOpcUa), which connects the models
to AutomationML (OPC 10000-83 Annex A, AML-UA-XSLT rules) and to VDI 3682
process descriptions.

Status: in development, see [docs/plan.md](docs/plan.md).

```bash
npm install
npm run dev        # http://localhost:3002
npm test
npm run typecheck
```

## Third-party content

`assets/nodesets/` holds the OPC UA base NodeSet (1.05.07) and the OPC UA for
Devices NodeSet (1.05.0) from [UA-Nodeset](https://github.com/OPCFoundation/UA-Nodeset),
OPC Foundation MIT License 1.00.

## License

MIT
