/**
 * A tiny XSD for unit tests: a `ClinicalDocument` in the HL7 v3 namespace with an `id` and a `title`.
 * The real CDA2 schemas come from the official it-fse-catalogs repository (`pnpm sync:catalogs`) and are
 * not committed.
 */
export const TEST_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:hl7-org:v3"
  xmlns="urn:hl7-org:v3" elementFormDefault="qualified">
  <xs:element name="ClinicalDocument">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id">
          <xs:complexType>
            <xs:attribute name="root" type="xs:string" use="required"/>
            <xs:attribute name="extension" type="xs:string"/>
          </xs:complexType>
        </xs:element>
        <xs:element name="title" type="xs:string"/>
        <xs:element name="count" type="xs:int" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

/** A document valid against {@link TEST_XSD}. */
export const TEST_XML_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="2.16.840.1.113883.2.9.2.999" extension="SYNTHETIC"/><title>Synthetic</title></ClinicalDocument>
`;

/** A document invalid against {@link TEST_XSD} (missing `title`, wrong element). */
export const TEST_XML_INVALID = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="2.16.840.1.113883.2.9.2.999"/><unexpected/></ClinicalDocument>
`;
