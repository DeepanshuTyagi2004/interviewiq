package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link RoundType} by its wire value ("system-design"), not the Java constant name, so
 * the DB column matches what crosses the service boundaries and the ai-service brief keys.
 */
@Converter
public class RoundTypeConverter implements AttributeConverter<RoundType, String> {

    @Override
    public String convertToDatabaseColumn(RoundType attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public RoundType convertToEntityAttribute(String dbData) {
        return dbData == null ? null : RoundType.fromValue(dbData);
    }
}
