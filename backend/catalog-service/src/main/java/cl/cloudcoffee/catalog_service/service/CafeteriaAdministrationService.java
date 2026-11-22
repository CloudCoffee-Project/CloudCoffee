package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.*;
import cl.cloudcoffee.catalog_service.model.entity.*;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import cl.cloudcoffee.catalog_service.repository.*;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.CafeteriaAccess;

@Service
@Transactional
public class CafeteriaAdministrationService {
    private final CampusRepository campusRepository;
    private final CafeteriaRepository cafeteriaRepository;
    private final CafeteriaAuditRepository auditRepository;
    private final CafeteriaAccess cafeteriaAccess;
    private final Clock clock;

    public CafeteriaAdministrationService(CampusRepository campusRepository,
                                          CafeteriaRepository cafeteriaRepository,
                                          CafeteriaAuditRepository auditRepository,
                                          CafeteriaAccess cafeteriaAccess,
                                          Clock clock) {
        this.campusRepository = campusRepository;
        this.cafeteriaRepository = cafeteriaRepository;
        this.auditRepository = auditRepository;
        this.cafeteriaAccess = cafeteriaAccess;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<CampusAdminResponse> listarCampus(Boolean activo, Pageable pageable) {
        return campusRepository.findAdmin(activo, safePage(pageable))
                .map(CampusAdminResponse::from);
    }

    public CampusAdminResponse crearCampus(CrearCampusRequest request, Authentication authentication) {
        superAdmin(authentication);
        String nombre = trim(request.nombre());
        validarNombre(nombre, 100);
        if (campusRepository.existsByNameIgnoreCase(nombre)) {
            throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
        }
        Campus campus = new Campus();
        campus.setName(nombre);
        campus.setLocation(request.direccion() == null ? null : request.direccion().trim());
        campus.setActive(true);
        campus.setVersion(1L);
        return CampusAdminResponse.from(campusRepository.save(campus));
    }

    public CampusAdminResponse editarCampus(UUID id, EditarCampusRequest request, Authentication authentication) {
        superAdmin(authentication);
        Campus campus = campusRepository.findById(id).orElseThrow(() -> notFound("Campus no encontrado"));
        if (campus.getVersion() == null || campus.getVersion() != request.version()) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
        if (request.nombre() != null) {
            String nombre = trim(request.nombre());
            validarNombre(nombre, 100);
            if (!nombre.equalsIgnoreCase(campus.getName()) && campusRepository.existsByNameIgnoreCase(nombre)) {
                throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
            }
            campus.setName(nombre);
        }
        if (request.direccion() != null) campus.setLocation(request.direccion().trim());
        return CampusAdminResponse.from(saveCampus(campus));
    }

    public CampusAdminResponse bajaCampus(UUID id, Authentication authentication) {
        superAdmin(authentication);
        Campus campus = campusRepository.findById(id).orElseThrow(() -> notFound("Campus no encontrado"));
        if (!campus.isActive()) return CampusAdminResponse.from(campus);
        if (cafeteriaRepository.countByCampusIdAndActiveTrue(id) > 0) {
            throw conflict("El campus tiene cafeterías activas", "CAMPUS_EN_USO");
        }
        campus.setActive(false);
        campus.setBajaAt(Instant.now(clock));
        return CampusAdminResponse.from(saveCampus(campus));
    }

    public CampusAdminResponse reactivarCampus(UUID id, Authentication authentication) {
        superAdmin(authentication);
        Campus campus = campusRepository.findById(id).orElseThrow(() -> notFound("Campus no encontrado"));
        if (!campus.isActive()) {
            campus.setActive(true);
            campus.setBajaAt(null);
            campus = saveCampus(campus);
        }
        return CampusAdminResponse.from(campus);
    }

    @Transactional(readOnly = true)
    public Page<CafeteriaResponse> listarCafeterias(UUID campusId, Boolean activa, Pageable pageable) {
        return cafeteriaRepository.findAdmin(campusId, activa, safePage(pageable)).map(CafeteriaResponse::from);
    }

    public CafeteriaResponse crearCafeteria(CrearCafeteriaRequest request, Authentication authentication) {
        superAdmin(authentication);
        Campus campus = campusRepository.findById(request.campusId()).orElseThrow(() -> notFound("Campus no encontrado"));
        if (!campus.isActive()) throw conflict("El campus está dado de baja", "CAMPUS_EN_USO");
        String nombre = trim(request.nombre());
        validarNombre(nombre, 150);
        if (cafeteriaRepository.existsByCampusIdAndNameIgnoreCase(campus.getId(), nombre)) {
            throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
        }
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setCampus(campus);
        cafeteria.setName(nombre);
        cafeteria.setStatus(CafeteriaStatus.CLOSED);
        cafeteria.setActive(true);
        cafeteria.setVersion(1L);
        cafeteria = cafeteriaRepository.save(cafeteria);
        audit(cafeteria, "CREAR", authentication, "Cafetería creada activa y CLOSED");
        return CafeteriaResponse.from(cafeteria);
    }

    public CafeteriaResponse editarCafeteria(UUID id, EditarCafeteriaRequest request,
                                             Authentication authentication) {
        superAdmin(authentication);
        Cafeteria cafeteria = cafeteriaRepository.findById(id).orElseThrow(() -> notFound("Cafetería no encontrada"));
        if (cafeteria.getVersion() == null || cafeteria.getVersion() != request.version()) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
        if (request.nombre() != null) {
            String nombre = trim(request.nombre());
            validarNombre(nombre, 150);
            if (!nombre.equalsIgnoreCase(cafeteria.getName())
                    && cafeteriaRepository.existsByCampusIdAndNameIgnoreCase(cafeteria.getCampus().getId(), nombre)) {
                throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
            }
            cafeteria.setName(nombre);
        }
        cafeteria = saveCafeteria(cafeteria);
        audit(cafeteria, "EDITAR", authentication, "Datos administrativos editados");
        return CafeteriaResponse.from(cafeteria);
    }

    public CafeteriaResponse bajaCafeteria(UUID id, Authentication authentication) {
        superAdmin(authentication);
        Cafeteria cafeteria = cafeteriaRepository.findById(id).orElseThrow(() -> notFound("Cafetería no encontrada"));
        if (cafeteria.isActive()) {
            cafeteria.setActive(false);
            cafeteria.setBajaAt(Instant.now(clock));
            cafeteria = saveCafeteria(cafeteria);
            audit(cafeteria, "BAJA", authentication, "Baja lógica");
        }
        return CafeteriaResponse.from(cafeteria);
    }

    public CafeteriaResponse reactivarCafeteria(UUID id, Authentication authentication) {
        superAdmin(authentication);
        Cafeteria cafeteria = cafeteriaRepository.findById(id).orElseThrow(() -> notFound("Cafetería no encontrada"));
        if (!cafeteria.isActive()) {
            if (!cafeteria.getCampus().isActive()) throw conflict("El campus está dado de baja", "CAMPUS_EN_USO");
            cafeteria.setActive(true);
            cafeteria.setBajaAt(null);
            cafeteria = saveCafeteria(cafeteria);
            audit(cafeteria, "REACTIVAR", authentication, "Reactivación lógica");
        }
        return CafeteriaResponse.from(cafeteria);
    }

    public CafeteriaResponse cambiarEstadoOperativo(UUID id, CambiarEstadoOperativoRequest request,
                                                    Authentication authentication) {
        cafeteriaAccess.verificar(authentication, id);
        Cafeteria cafeteria = cafeteriaRepository.findById(id).orElseThrow(() -> notFound("Cafetería no encontrada"));
        if (!cafeteria.isActive()) throw conflict("La cafetería está dada de baja", "CAFETERIA_DADA_DE_BAJA");
        if (cafeteria.getVersion() == null || cafeteria.getVersion() != request.version()) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
        cafeteria.setStatus(request.estadoOperativo());
        cafeteria = saveCafeteria(cafeteria);
        audit(cafeteria, "ESTADO_OPERATIVO", authentication,
                "Estado operativo cambiado a " + request.estadoOperativo());
        return CafeteriaResponse.from(cafeteria);
    }

    @Transactional(readOnly = true)
    public CafeteriaResponse detalleCafeteria(UUID id) {
        return CafeteriaResponse.from(cafeteriaRepository.findById(id)
                .orElseThrow(() -> notFound("Cafetería no encontrada")));
    }

    private void audit(Cafeteria cafeteria, String accion, Authentication authentication, String detalle) {
        CafeteriaAudit audit = new CafeteriaAudit();
        audit.setCafeteriaId(cafeteria.getId());
        audit.setCampusId(cafeteria.getCampus().getId());
        audit.setAccion(accion);
        audit.setActorId(authentication instanceof JwtAuthenticationToken token ? token.getToken().getSubject() : null);
        audit.setDetalle(detalle);
        audit.setCreadoAt(Instant.now(clock));
        auditRepository.save(audit);
    }

    private Campus saveCampus(Campus campus) {
        try { return campusRepository.save(campus); }
        catch (OptimisticLockingFailureException exception) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
    }

    private Cafeteria saveCafeteria(Cafeteria cafeteria) {
        try { return cafeteriaRepository.save(cafeteria); }
        catch (OptimisticLockingFailureException exception) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
    }

    private void superAdmin(Authentication authentication) {
        boolean allowed = authentication != null && authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_SUPER_ADMIN"));
        if (!allowed) throw new org.springframework.security.access.AccessDeniedException("Rol no permitido");
    }

    private static Pageable safePage(Pageable pageable) {
        int page = Math.max(pageable.getPageNumber(), 0);
        int size = Math.max(1, Math.min(pageable.getPageSize(), 100));
        return PageRequest.of(page, size, Sort.by(Sort.Order.asc("name"), Sort.Order.asc("id")));
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static void validarNombre(String nombre, int max) {
        if (nombre == null || nombre.isBlank() || nombre.length() > max) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/nombre-invalido"),
                    "Nombre inválido", "El nombre es obligatorio y no puede exceder " + max + " caracteres.");
        }
    }

    private static BusinessException conflict(String detail, String code) {
        return new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/" + code.toLowerCase()),
                "Conflicto", detail, code);
    }

    private static BusinessException notFound(String detail) {
        return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/recurso-no-encontrado"),
                "Recurso no encontrado", detail);
    }
}
